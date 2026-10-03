import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

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

type Resolve = (hostname: string) => Promise<{ address: string }[]>
type FetchPage = (url: string, init: RequestInit) => Promise<Response>

const resolvePublic: Resolve = (hostname) => lookup(hostname, { all: true, verbatim: true })

export async function readWebsite(input: string, fetchPage: FetchPage = fetch, resolve: Resolve = resolvePublic): Promise<string> {
  const page = await fetchPublic(input, fetchPage, resolve, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1')
  if (!isHtml(page.type, page.body)) return `Could not read ${page.url}: the response is not an HTML page.`
  const stylesheets = stylesheetLinks(page.body, page.url).slice(0, 4)
  const css: string[] = []
  for (const href of stylesheets) {
    try {
      const sheet = await fetchPublic(href, fetchPage, resolve, 'text/css,*/*;q=0.1')
      if (!sheet.type.includes('text/css') && !href.endsWith('.css')) continue
      const appearance = extractAppearance(sheet.body)
      if (appearance) css.push(appearance)
    } catch {
      continue
    }
  }
  return summarizePage(page.url, page.body, css.join('\n'))
}

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

export function summarizePage(url: string, html: string, appearance: string): string {
  const title = textContent(matchOne(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? '')
  const headings = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => textContent(match[2] ?? ''))
    .filter(Boolean)
    .slice(0, 12)
  const region = matchOne(html, /<(?:nav|header)[^>]*>[\s\S]{0,12000}?<\/(?:nav|header)>/i) ?? html.slice(0, 12000)
  const links = [...region.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const label = textContent(match[2] ?? '')
      return label ? `${label} → ${match[1]}` : ''
    })
    .filter(Boolean)
    .slice(0, 25)
  const inline = extractAppearance(inlineCss(html))
  const style = [inline, appearance].filter(Boolean).join('\n').slice(0, 6000)
  const excerpt = textContent(html.replace(/<(?:script|style|noscript)[^>]*>[\s\S]*?<\/(?:script|style|noscript)>/gi, ' ')).slice(0, 4000)
  return [
    `URL: ${url}`,
    title ? `Title: ${title}` : '',
    headings.length ? `Headings:\n${headings.map((heading) => `- ${heading}`).join('\n')}` : '',
    links.length ? `Links:\n${links.map((link) => `- ${link}`).join('\n')}` : '',
    style ? `Colors and type:\n${style}` : '',
    excerpt ? `Text:\n${excerpt}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function extractAppearance(css: string): string {
  const found = [
    ...(css.match(/--[a-z0-9-]+\s*:\s*[^;}{]{1,60}/gi) ?? []),
    ...(css.match(/(?:font-family|font-size|color|background(?:-color)?)\s*:\s*[^;}{]{1,80}/gi) ?? []),
  ]
  return [...new Set(found.map((item) => item.replace(/\s+/g, ' ').trim()).filter((item) => !item.endsWith(':')))].slice(0, 80).join('\n')
}

async function fetchPublic(input: string, fetchPage: FetchPage, resolve: Resolve, accept: string): Promise<{ url: string; type: string; body: string }> {
  let current = await assertPublicUrl(input, resolve)
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetchPage(current.href, {
      redirect: 'manual',
      headers: { accept, 'user-agent': 'schloR editor' },
      signal: AbortSignal.timeout(12_000),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`Could not read ${current.href}: the redirect has no destination.`)
      current = await assertPublicUrl(new URL(location, current).href, resolve)
      continue
    }
    if (!response.ok) throw new Error(`Could not read ${current.href}: HTTP ${response.status}.`)
    return { url: current.href, type: response.headers.get('content-type') ?? '', body: await readLimited(response, 350_000) }
  }
  throw new Error(`Could not read ${input}: too many redirects.`)
}

function addressBlocked(address: string): boolean {
  const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : address
  if (isIP(mapped) === 4) return blocked.check(mapped, 'ipv4')
  if (isIP(address) === 6) return blocked.check(address, 'ipv6')
  return true
}

function stylesheetLinks(html: string, pageUrl: string): string[] {
  const hrefs = [...html.matchAll(/<link\s[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi)].map((match) => attribute(match[0] ?? '', 'href'))
  const ranked: { href: string; rank: number }[] = []
  for (const href of hrefs) {
    if (!href) continue
    try {
      const absolute = new URL(href, pageUrl)
      if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') continue
      const rank = stylesheetRank(absolute.pathname)
      if (rank < 0) continue
      ranked.push({ href: absolute.href, rank })
    } catch {
      continue
    }
  }
  return ranked.sort((a, b) => b.rank - a.rank).map((item) => item.href)
}

function stylesheetRank(pathname: string): number {
  const path = pathname.toLowerCase()
  if (/wp-includes|font-awesome|dashicons|bootstrap|block-library|block-editor|google-fonts|fonts\.gstatic/.test(path)) return -1
  let rank = 0
  if (path.includes('/themes/')) rank += 5
  if (path.includes('/uploads/elementor/css/')) rank += 4
  if (path.includes('style')) rank += 1
  return rank
}

function inlineCss(html: string): string {
  return [...html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi)]
    .filter((match) => !/global-styles|block-library|block-supports|wp-img-auto/i.test(match[1] ?? ''))
    .map((match) => match[2] ?? '')
    .join('\n')
}

function attribute(tag: string, name: string): string {
  return tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] ?? ''
}

function isHtml(type: string, body: string): boolean {
  return type.includes('text/html') || type.includes('application/xhtml') || /^\s*</.test(body)
}

function matchOne(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[0]
}

function textContent(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function decodeEntities(html: string): string {
  return html
    .replace(/&#(\d+);/g, (_, value) => codePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => codePoint(Number.parseInt(value, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function codePoint(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return ''
  return String.fromCodePoint(value)
}

export async function fetchPublicBytes(
  input: string,
  fetchPage: FetchPage = fetch,
  resolve: Resolve = resolvePublic,
  max = 8_000_000,
): Promise<{ url: string; type: string; body: Uint8Array }> {
  let current = await assertPublicUrl(input, resolve)
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetchPage(current.href, {
      redirect: 'manual',
      headers: { accept: 'image/*,*/*;q=0.1', 'user-agent': 'schloR editor' },
      signal: AbortSignal.timeout(12_000),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`Could not read ${current.href}: the redirect has no destination.`)
      current = await assertPublicUrl(new URL(location, current).href, resolve)
      continue
    }
    if (!response.ok) throw new Error(`Could not read ${current.href}: HTTP ${response.status}.`)
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength > max) throw new Error('That picture is larger than 8 MB.')
    return { url: current.href, type: response.headers.get('content-type') ?? '', body }
  }
  throw new Error(`Could not read ${input}: too many redirects.`)
}

async function readLimited(response: Response, max: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  while (size < max) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    text += decoder.decode(value, { stream: true })
  }
  await reader.cancel().catch(() => undefined)
  return text.slice(0, max)
}
