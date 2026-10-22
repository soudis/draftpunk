import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import zlib from 'node:zlib'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv6')
}

export type Resolve = (hostname: string) => Promise<{ address: string }[]>

export const resolvePublic: Resolve = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true })

export async function assertPublicUrl(input: string, resolve: Resolve = resolvePublic): Promise<URL> {
  const trimmed = input.trim()
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${input} is not a public website.`)
  if (url.username || url.password) throw new Error(`${input} is not a public website.`)
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error(`${input} is not a public website.`)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error(`${url.origin} is not a public website.`)
  }
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host).catch(() => [])
  if (addresses.length === 0) throw new Error(`Could not resolve ${host}.`)
  if (addresses.some((item) => addressBlocked(item.address))) throw new Error(`${url.origin} is not a public website.`)
  return url
}

export function addressBlocked(address: string): boolean {
  const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : address
  if (isIP(mapped) === 4) return blocked.check(mapped, 'ipv4')
  if (isIP(address) === 6) return blocked.check(address, 'ipv6')
  return true
}


// Checked when the socket connects, so the address that is checked is the address that is used.
// A name that answers with a public address first and a private one later cannot get through.
export function publicLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error)
    if (addresses.length === 0 || addresses.some((item) => addressBlocked(item.address))) {
      return callback(Object.assign(new Error(`${hostname} is not a public website.`), { code: 'EBLOCKED' }))
    }
    if (options.all) return callback(null, addresses)
    return callback(null, addresses[0].address, addresses[0].family)
  })
}

const BROWSER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 schloR-editor'

export type SafeFetchInit = RequestInit & {
  /** Read at most this many bytes of the body. The rest is dropped. */
  maxBytes?: number
}

/**
 * One request to a public website, with no redirect followed. The caller follows a redirect itself, so it
 * can check the next address too. Only ports 80 and 443 and only public addresses are reached.
 */
export async function safeFetch(input: string, init: SafeFetchInit = {}): Promise<Response> {
  const url = new URL(input)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${input} is not a public website.`)
  if (url.username || url.password) throw new Error(`${input} is not a public website.`)
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error(`${input} is not a public website.`)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error(`${url.origin} is not a public website.`)
  if (isIP(host) && addressBlocked(host)) throw new Error(`${url.origin} is not a public website.`)
  const headers: Record<string, string> = { 'user-agent': BROWSER_AGENT, 'accept-encoding': 'gzip, deflate, br' }
  for (const [name, value] of new Headers(init.headers).entries()) headers[name.toLowerCase()] = value
  const maxBytes = init.maxBytes ?? 5_000_000
  const transport = url.protocol === 'https:' ? https : http
  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      url,
      { method: init.method ?? 'GET', headers, lookup: publicLookup as never },
      (response) => {
        const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase()
        const decoder = encoding.includes('br') ? zlib.createBrotliDecompress() : encoding.includes('gzip') ? zlib.createGunzip() : encoding.includes('deflate') ? zlib.createInflate() : null
        const source = decoder ? response.pipe(decoder) : response
        const chunks: Buffer[] = []
        let size = 0
        let done = false
        const finish = (truncated: boolean) => {
          if (done) return
          done = true
          response.destroy()
          const result = new Headers()
          for (const [name, value] of Object.entries(response.headers)) {
            if (value === undefined || ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'].includes(name)) continue
            result.set(name, Array.isArray(value) ? value.join(', ') : value)
          }
          if (truncated) result.set('x-truncated', '1')
          const status = response.statusCode ?? 502
          resolve(new Response(status === 204 || status === 304 || (status >= 100 && status < 200) ? null : Buffer.concat(chunks), { status, headers: result }))
        }
        source.on('data', (chunk: Buffer) => {
          size += chunk.length
          chunks.push(chunk)
          if (size >= maxBytes) finish(true)
        })
        source.on('end', () => finish(false))
        source.on('error', (error) => {
          if (!done) {
            done = true
            reject(error)
          }
        })
      },
    )
    request.setTimeout(15_000, () => request.destroy(new Error(`Could not read ${url.origin}: it did not answer in time.`)))
    request.on('error', (error: NodeJS.ErrnoException) => reject(error.code === 'EBLOCKED' ? new Error(`${url.origin} is not a public website.`) : error))
    init.signal?.addEventListener('abort', () => request.destroy(new Error('The request was cancelled.')), { once: true })
    request.end()
  })
}
