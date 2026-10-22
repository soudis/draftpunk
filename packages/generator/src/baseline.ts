import fs from 'node:fs'
import path from 'node:path'
import { imageSize } from 'image-size'

const ATTRIBUTE = (name: string) => new RegExp(`\\s${name}\\s*=`, 'i')

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag)?.[2]
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

const dimensions = new Map<string, { width: number; height: number } | null>()

/** The size of a picture that is stored in the site, or null. Kept by file and time, so a changed picture is read again. */
export function pictureSize(root: string, address: string): { width: number; height: number } | null {
  const clean = address.split(/[?#]/)[0]
  if (!clean.startsWith('/media/') || clean.includes('..')) return null
  const file = path.join(root, clean.slice(1))
  let key: string
  try {
    key = `${file}:${fs.statSync(file).mtimeMs}`
  } catch {
    return null
  }
  if (dimensions.has(key)) return dimensions.get(key) ?? null
  let size: { width: number; height: number } | null = null
  try {
    const found = imageSize(fs.readFileSync(file))
    if (found.width && found.height) size = { width: found.width, height: found.height }
  } catch {
    size = null
  }
  dimensions.set(key, size)
  return size
}

/**
 * Pictures that load as the page needs them and keep their space. A picture in the header, and the first
 * one after it, stay eager: they are on the first screen. An attribute the design wrote is left as it is.
 */
export function enhancePictures(html: string, root: string): string {
  const header = /<header\b[\s\S]*?<\/header>/i.exec(html)
  const headerEnd = header ? header.index + header[0].length : -1
  let afterHeader = 0
  return html.replace(/<img\b[^>]*>/gi, (tag, offset: number) => {
    let next = tag
    const inHeader = header !== null && offset >= header.index && offset < headerEnd
    if (!inHeader) afterHeader += 1
    const eager = inHeader || afterHeader === 1
    const add: string[] = []
    if (!ATTRIBUTE('loading').test(next) && !eager) add.push('loading="lazy"')
    if (!ATTRIBUTE('decoding').test(next)) add.push('decoding="async"')
    if (!ATTRIBUTE('width').test(next) && !ATTRIBUTE('height').test(next)) {
      const src = attribute(next, 'src')
      const size = src ? pictureSize(root, src) : null
      if (size) add.push(`width="${size.width}"`, `height="${size.height}"`)
    }
    if (add.length === 0) return next
    next = next.replace(/\s*\/?>$/, (end) => ` ${add.join(' ')}${end.trim() === '/>' ? ' />' : '>'}`)
    return next
  })
}

export type PageMeta = {
  title: string
  description?: string
  lang: string
  /** The address of the page on the site, such as /werkstatt/ */
  path: string
}

const LOCALE: Record<string, string> = { de: 'de_AT', en: 'en_GB', fr: 'fr_FR', it: 'it_IT', es: 'es_ES' }

/** What a page says about itself to search engines and when it is shared. A tag the design already wrote is kept. */
export function enhanceHead(
  html: string,
  meta: PageMeta,
  site: { name: string; url?: string },
  extra: { preload: string[]; themeColor?: string },
): string {
  const close = /<\/head>/i.exec(html)
  if (!close) return html
  const head = html.slice(0, close.index)
  const tags: string[] = [...extra.preload.filter((link) => !head.includes(link.match(/href="([^"]+)"/)?.[1] ?? '\u0000'))]
  const has = (pattern: RegExp) => pattern.test(head)
  const description = (meta.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (description && !has(/<meta[^>]+name=["']description["']/i)) tags.push(`<meta name="description" content="${escapeAttribute(description)}">`)
  if (!has(/<meta[^>]+property=["']og:title["']/i)) {
    tags.push(`<meta property="og:title" content="${escapeAttribute(meta.title)}">`, '<meta property="og:type" content="website">', `<meta property="og:site_name" content="${escapeAttribute(site.name)}">`)
    tags.push(`<meta property="og:locale" content="${LOCALE[meta.lang] ?? meta.lang}">`)
    if (description) tags.push(`<meta property="og:description" content="${escapeAttribute(description)}">`)
    if (site.url) tags.push(`<meta property="og:url" content="${escapeAttribute(site.url + meta.path)}">`)
  }
  if (site.url && !has(/<link[^>]+rel=["']canonical["']/i)) tags.push(`<link rel="canonical" href="${escapeAttribute(site.url + meta.path)}">`)
  if (extra.themeColor && !has(/<meta[^>]+name=["']theme-color["']/i)) tags.push(`<meta name="theme-color" content="${escapeAttribute(extra.themeColor)}">`)
  if (tags.length === 0) return html
  return `${html.slice(0, close.index)}  ${tags.join('\n  ')}\n${html.slice(close.index)}`
}

/** The first words of what a page says, for its description. A long text is cut at a word. */
export function describe(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= 160) return text
  return `${text.slice(0, 160).replace(/\s+\S*$/, '')}…`
}

export function sitemapXml(site: { url: string }, paths: string[]): string {
  const urls = [...new Set(paths)].sort().map((urlPath) => `  <url><loc>${escapeAttribute(site.url + urlPath)}</loc></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

export function robotsTxt(site: { url?: string }): string {
  return `User-agent: *\nAllow: /\n${site.url ? `\nSitemap: ${site.url}/sitemap.xml\n` : ''}`
}
