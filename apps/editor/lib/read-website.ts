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
  return presentPage(page.url, page.body, css.join('\n'))
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

const PAGE_HTML_CAP = 80_000

export function presentPage(url: string, html: string, appearance: string): string {
  const prepared = capHtml(preparePageHtml(html, url), PAGE_HTML_CAP)
  const style = [extractAppearance(inlineCss(html)), appearance].filter(Boolean).join('\n').slice(0, 6000)
  return [`URL: ${url}`, prepared, style ? `Colors and type:\n${style}` : ''].filter(Boolean).join('\n\n')
}

export function preparePageHtml(html: string, pageUrl: string): string {
  const revealed = revealEmails(html)
  const stripped = revealed
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
  const withPictures = stripped
    .replace(/<img\b[^>]*>/gi, (tag) => collapsePicture(tag, pageUrl))
    .replace(/<source\b[^>]*>/gi, (tag) => collapseSource(tag, pageUrl))
  const absolute = absolutizeTags(withPictures, pageUrl)
  return fillMailtoText(absolute)
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
  return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))?.[2] ?? ''
}

function attributePattern(name: string): RegExp {
  return new RegExp(`\\s${name}\\s*=\\s*(["'])[\\s\\S]*?\\1`, 'i')
}

function setAttribute(tag: string, name: string, value: string): string {
  const written = ` ${name}="${value.replace(/"/g, '&quot;')}"`
  if (attributePattern(name).test(tag)) return tag.replace(attributePattern(name), written)
  return tag.replace(/\s*\/?>$/, `${written}>`)
}

function removeAttribute(tag: string, name: string): string {
  return tag.replace(attributePattern(name), '')
}

function capHtml(html: string, max: number): string {
  if (html.length <= max) return html
  const slice = html.slice(0, max)
  const close = slice.lastIndexOf('>')
  return close > max - 200 ? slice.slice(0, close + 1) : slice
}

function revealEmails(html: string): string {
  return html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (whole) => {
    const open = whole.match(/^<a\b[^>]*>/i)?.[0] ?? ''
    const email = emailFromTag(open) || emailFromMarkup(whole)
    if (!email) return whole
    let opened = setAttribute(open, 'href', `mailto:${email}`)
    opened = removeAttribute(opened, 'data-enc-email')
    opened = removeAttribute(opened, 'data-cfemail')
    return whole.replace(/^<a\b[^>]*>/i, opened)
  })
}

function emailFromTag(tag: string): string {
  const encoded = attribute(tag, 'data-enc-email')
  if (encoded) return decodeRot13Email(encoded)
  return decodeCfEmail(cfHex(tag))
}

function emailFromMarkup(html: string): string {
  const cf = decodeCfEmail(html.match(/\sdata-cfemail=(["'])([0-9a-f]+)\1/i)?.[2] ?? '')
  if (cf) return cf
  for (const match of html.matchAll(/%[0-9A-Fa-f]{2}(?:%[0-9A-Fa-f]{2})+/g)) {
    try {
      const email = decodeURIComponent(match[0]).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
      if (email) return email
    } catch {
      // A broken percent-encoded fragment is not an address.
    }
  }
  return ''
}

function cfHex(tag: string): string {
  const encoded = attribute(tag, 'data-cfemail')
  if (encoded) return encoded
  return attribute(tag, 'href').match(/email-protection#([0-9a-f]+)/i)?.[1] ?? ''
}

function decodeRot13Email(value: string): string {
  const normalized = value.replace(/\s*(?:\[at\]|\(at\)|\{at\})\s*/gi, '@').replace(/\s*\[dot\]\s*/gi, '.')
  const rotated = normalized.replace(/[A-Za-z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base)
  })
  return emailAddress(rotated)
}

function decodeCfEmail(hex: string): string {
  const clean = hex.replace(/[^0-9a-f]/gi, '')
  if (clean.length < 4 || clean.length % 2 !== 0) return ''
  const bytes = [...clean.matchAll(/../g)].map((pair) => Number.parseInt(pair[0], 16))
  const key = bytes[0] ?? 0
  return emailAddress(bytes.slice(1).map((byte) => String.fromCharCode(byte ^ key)).join(''))
}

function emailAddress(value: string): string {
  const email = value.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function fillMailtoText(html: string): string {
  return html.replace(/<a\b[^>]*href=(["'])mailto:([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi, (whole, _quote, email, inner) => {
    const text = textContent(inner)
    if (text && !/protected email/i.test(text)) return whole
    return whole.replace(/>[\s\S]*<\/a>$/i, `>${email}</a>`)
  })
}

function collapsePicture(tag: string, pageUrl: string): string {
  const url = largestPicture(pictureCandidates(tag, pageUrl))
  let next = tag
  if (url) next = setAttribute(next, 'src', url)
  for (const name of ['srcset', 'sizes', 'data-src', 'data-lazy-src', 'data-original', 'data-orig-file', 'data-large-file']) {
    next = removeAttribute(next, name)
  }
  return next
}

function collapseSource(tag: string, pageUrl: string): string {
  const srcset = attribute(tag, 'srcset')
  if (!srcset) return tag
  const url = largestPicture(candidatesFromSrcset(srcset, pageUrl))
  let next = removeAttribute(tag, 'srcset')
  next = removeAttribute(next, 'sizes')
  return url ? setAttribute(next, 'srcset', url) : next
}

function pictureCandidates(tag: string, pageUrl: string): { url: string; width: number }[] {
  const found: { url: string; width: number }[] = []
  for (const name of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-orig-file', 'data-large-file']) {
    const value = attribute(tag, name)
    if (!isPictureUrl(value)) continue
    found.push({ url: absoluteUrl(value, pageUrl), width: pictureWidth(value, '') })
  }
  found.push(...candidatesFromSrcset(attribute(tag, 'srcset'), pageUrl))
  return found
}

function candidatesFromSrcset(srcset: string, pageUrl: string): { url: string; width: number }[] {
  const found: { url: string; width: number }[] = []
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/)
    const raw = bits[0] ?? ''
    if (!isPictureUrl(raw)) continue
    found.push({ url: absoluteUrl(raw, pageUrl), width: pictureWidth(raw, bits.slice(1).join(' ')) })
  }
  return found
}

function largestPicture(candidates: { url: string; width: number }[]): string {
  if (candidates.length === 0) return ''
  const known = candidates.filter((item) => item.width > 0)
  const pool = known.length > 0 ? known : candidates
  return pool.reduce((best, item) => (item.width > best.width ? item : best)).url
}

function pictureWidth(url: string, descriptor: string): number {
  const declared = /(\d+)w/i.exec(descriptor)?.[1]
  if (declared) return Number(declared)
  const sized = /-(\d+)x\d+(?=\.[a-z0-9]+(?:$|\?))/i.exec(url)?.[1]
  return sized ? Number(sized) : 0
}

function isPictureUrl(value: string): boolean {
  return Boolean(value) && !/^(?:data:|javascript:|blob:)/i.test(value)
}

function absolutizeTags(html: string, pageUrl: string): string {
  return html.replace(/<[a-z0-9:-]+\b[^>]*>/gi, (tag) => {
    let next = tag
    for (const name of ['href', 'src', 'poster', 'action']) {
      const value = attribute(next, name)
      if (!value) continue
      next = setAttribute(next, name, absoluteUrl(value, pageUrl))
    }
    const style = attribute(next, 'style')
    if (style && /url\(/i.test(style)) next = setAttribute(next, 'style', absolutizeStyle(style, pageUrl))
    return next
  })
}

function absolutizeStyle(value: string, pageUrl: string): string {
  return value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_all, quote: string, raw: string) => {
    return `url(${quote}${absoluteUrl(raw, pageUrl)}${quote})`
  })
}

function absoluteUrl(value: string, pageUrl: string): string {
  const trimmed = value.trim()
  if (!trimmed || /^(?:mailto:|tel:|javascript:|data:|#)/i.test(trimmed)) return trimmed
  try {
    return new URL(trimmed, pageUrl).href
  } catch {
    return trimmed
  }
}

function isHtml(type: string, body: string): boolean {
  return type.includes('text/html') || type.includes('application/xhtml') || /^\s*</.test(body)
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
