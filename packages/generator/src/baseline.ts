import fs from 'node:fs'
import path from 'node:path'
import { imageSize } from 'image-size'
import { parse as parseYaml } from 'yaml'
import type { SizePlan } from './sizes'
import { firstMainImage, jsonLdTag, type Json } from './structured'

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

/** Whether a picture can have see-through parts: a PNG or WebP with an alpha channel or a transparent colour, a GIF, an SVG. A JPEG never does. */
export function hasTransparency(bytes: Uint8Array): boolean {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (b.length > 33 && b.readUInt32BE(0) === 0x89504e47) {
    if (b[25] === 4 || b[25] === 6) return true
    for (let at = 8; at + 12 <= b.length; ) {
      const type = b.toString('latin1', at + 4, at + 8)
      if (type === 'tRNS') return true
      if (type === 'IDAT' || type === 'IEND') return false
      at += 12 + b.readUInt32BE(at)
    }
    return false
  }
  if (b.length > 25 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const kind = b.toString('latin1', 12, 16)
    if (kind === 'VP8X') return (b[20] & 0x10) !== 0
    if (kind === 'VP8L') return ((b[24] >> 4) & 1) === 1
    return false
  }
  if (b.toString('latin1', 0, 3) === 'GIF') return true
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(b.toString('utf8', 0, Math.min(b.length, 1024)))
}

const transparency = new Map<string, boolean>()

/** Whether a picture stored in the site can have see-through parts. Kept by file and time. */
export function pictureIsTransparent(root: string, address: string): boolean {
  const clean = address.split(/[?#]/)[0]
  if (!clean.startsWith('/media/') || clean.includes('..')) return false
  const file = path.join(root, clean.slice(1))
  let key: string
  try {
    key = `${file}:${fs.statSync(file).mtimeMs}`
  } catch {
    return false
  }
  const known = transparency.get(key)
  if (known !== undefined) return known
  let found = false
  try {
    found = hasTransparency(fs.readFileSync(file))
  } catch {
    found = false
  }
  transparency.set(key, found)
  return found
}

/** What the site says about its pictures, from media/pictures.yml: what a picture shows, per language when it matters, and whether it is only decoration. */
export type PictureNotes = Map<string, { alt?: Record<string, string>; description?: string; decorative?: boolean }>

export function readPictureNotes(root: string): PictureNotes {
  const notes: PictureNotes = new Map()
  let entries: unknown
  try {
    entries = parseYaml(fs.readFileSync(path.join(root, 'media', 'pictures.yml'), 'utf8'))
  } catch {
    return notes
  }
  if (!Array.isArray(entries)) return notes
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') continue
    const alt: Record<string, string> = {}
    if (entry.alt && typeof entry.alt === 'object') {
      for (const [lang, text] of Object.entries(entry.alt)) if (typeof text === 'string' && text.trim()) alt[lang] = text.trim()
    }
    notes.set(entry.file, {
      ...(Object.keys(alt).length > 0 ? { alt } : {}),
      ...(typeof entry.description === 'string' && entry.description.trim() ? { description: entry.description.trim() } : {}),
      ...(entry.decorative === true ? { decorative: true } : {}),
    })
  }
  return notes
}

/** The words for a picture's `alt`: its own text for the language, else the start of its description. Nothing for a decoration. */
export function altFor(notes: PictureNotes, address: string, lang: string): string {
  const note = notes.get(address.split(/[?#]/)[0].replace(/^\/media\//, ''))
  if (!note || note.decorative) return ''
  const own = note.alt?.[lang] ?? ''
  if (own) return own
  const text = (note.description ?? '').replace(/\s+/g, ' ').trim()
  return text.length <= 140 ? text : `${text.slice(0, 140).replace(/\s+\S*$/, '')}…`
}

export type PictureOptions = { lang?: string; notes?: PictureNotes; sizes?: SizePlan }

/**
 * Pictures that load as the page needs them and keep their space. A picture in the header, and the first
 * one after it, stay eager: they are on the first screen. An attribute the design wrote is left as it is.
 */
export function enhancePictures(html: string, root: string, options: PictureOptions = {}): string {
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
    // The starter puts a calm color behind a picture while it loads; behind a logo with see-through parts it would be a box.
    const source = attribute(next, 'src')
    if (!ATTRIBUTE('data-transparent').test(next) && source && pictureIsTransparent(root, source)) add.push('data-transparent')
    // A picture says what it shows: the text the site keeps for it, when the page has none (or an empty one, as an import leaves it).
    const words = attribute(next, 'alt')
    if (options.notes && source && (words === undefined || words.trim() === '') && !/\b(?:role\s*=\s*["']presentation["']|aria-hidden\s*=\s*["']true["'])/i.test(next)) {
      const found = altFor(options.notes, source, options.lang ?? '')
      if (found) {
        if (words === undefined) add.push(`alt="${escapeAttribute(found)}"`)
        else next = next.replace(/(\salt\s*=\s*)(["'])\s*\2/i, (_whole, before: string) => `${before}"${escapeAttribute(found)}"`)
      }
    }
    // Smaller copies for a screen that needs less, unless the design chose its own.
    const planned = source && !ATTRIBUTE('srcset').test(next) ? options.sizes?.plan(source, pictureSize(root, source)) : null
    if (planned) {
      next = next.replace(/(\ssrc\s*=\s*)(["'])[^"']*\2/i, (_whole, before: string) => `${before}"${planned.src}"`)
      add.push(`srcset="${planned.srcset}"`)
      if (!ATTRIBUTE('sizes').test(next)) add.push('sizes="auto, (min-width: 900px) 900px, 100vw"')
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
  /** A page that search engines should not list, such as the search results. */
  noindex?: boolean
  /** A post has a day, and is shared as an article. */
  kind?: 'post'
  date?: string
  /** The day the page's content last changed (YYYY-MM-DD), for the sitemap. */
  modified?: string
  /** schema.org data for the page. A picture is added to a post or an event when the page has one. */
  structured?: Json[]
}

const LOCALE: Record<string, string> = { de: 'de_AT', en: 'en_GB', fr: 'fr_FR', it: 'it_IT', es: 'es_ES' }

/**
 * The links to the other languages of a page, as search engines want them: whole addresses, one for the page itself,
 * and x-default for the language a visitor gets when nothing fits. The design writes the links; they are made whole here.
 */
function withAbsoluteAlternates(head: string, meta: PageMeta, site: { url?: string; languages?: { id: string }[] }): string {
  if (!site.url) return head
  const base = site.url
  const found = new Map<string, string>()
  const whole = head.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel=["']alternate["']/i.test(tag)) return tag
    const lang = /\bhreflang=["']([^"']+)["']/i.exec(tag)?.[1]
    const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1]
    if (!lang || !href) return tag
    const address = href.startsWith('/') ? `${base}${href}` : href
    found.set(lang, address)
    return href.startsWith('/') ? tag.replace(href, address) : tag
  })
  if (found.size === 0) return head
  const add: string[] = []
  const own = `${base}${meta.path}`
  if (!found.has(meta.lang)) add.push(`<link rel="alternate" hreflang="${meta.lang}" href="${escapeAttribute(own)}">`)
  const first = site.languages?.[0]?.id
  const standard = first === meta.lang ? own : first ? found.get(first) : undefined
  if (standard && !found.has('x-default')) add.push(`<link rel="alternate" hreflang="x-default" href="${escapeAttribute(standard)}">`)
  return add.length === 0 ? whole : `${whole}  ${add.join('\n  ')}\n`
}

/** What a page says about itself to search engines and when it is shared. A tag the design already wrote is kept. */
export function enhanceHead(
  html: string,
  meta: PageMeta,
  site: { name: string; url?: string; assets?: Record<string, string>; languages?: { id: string }[]; feeds?: Record<string, string> },
  extra: { preload: string[]; themeColor?: string },
): string {
  const close = /<\/head>/i.exec(html)
  if (!close) return html
  const head = withoutRepeatedName(withAbsoluteAlternates(html.slice(0, close.index), meta, site), site.name)
  const tags: string[] = [...extra.preload.filter((link) => !head.includes(link.match(/href="([^"]+)"/)?.[1] ?? '\u0000'))]
  const has = (pattern: RegExp) => pattern.test(head)
  const description = ((meta.description ?? '').trim() || firstParagraph(html)).replace(/\s+/g, ' ').trim().slice(0, 200)
  if (description && !has(/<meta[^>]+name=["']description["']/i)) tags.push(`<meta name="description" content="${escapeAttribute(description)}">`)
  if (!has(/<meta[^>]+property=["']og:title["']/i)) {
    tags.push(`<meta property="og:title" content="${escapeAttribute(meta.title)}">`, `<meta property="og:type" content="${meta.kind === 'post' ? 'article' : 'website'}">`, `<meta property="og:site_name" content="${escapeAttribute(site.name)}">`)
    if (meta.kind === 'post' && meta.date) tags.push(`<meta property="article:published_time" content="${escapeAttribute(meta.date)}">`)
    tags.push(`<meta property="og:locale" content="${LOCALE[meta.lang] ?? meta.lang}">`)
    if (description) tags.push(`<meta property="og:description" content="${escapeAttribute(description)}">`)
    if (site.url) tags.push(`<meta property="og:url" content="${escapeAttribute(site.url + meta.path)}">`)
  }
  if (site.url && !has(/<link[^>]+rel=["']canonical["']/i)) tags.push(`<link rel="canonical" href="${escapeAttribute(site.url + meta.path)}">`)
  if (meta.noindex && !has(/<meta[^>]+name=["']robots["']/i)) tags.push('<meta name="robots" content="noindex, follow">')
  const icon = site.assets?.favicon
  if (icon && !has(/<link[^>]+rel=["'](?:shortcut )?icon["']/i)) tags.push(`<link rel="icon" href="${escapeAttribute(icon)}">`)
  // The picture a page is shared with: its own first large picture, else the site's share picture.
  const pagePicture = site.url ? firstMainImage(html) : undefined
  const share = pagePicture ?? site.assets?.social
  if (share && site.url && !has(/<meta[^>]+property=["']og:image["']/i)) tags.push(`<meta property="og:image" content="${escapeAttribute(site.url + share)}">`)
  if (site.url && !has(/<meta[^>]+name=["']twitter:card["']/i)) tags.push(`<meta name="twitter:card" content="${share ? 'summary_large_image' : 'summary'}">`)
  const feed = site.feeds?.[meta.lang]
  if (feed && !has(/<link[^>]+type=["']application\/(?:atom|rss)\+xml["']/i)) tags.push(`<link rel="alternate" type="application/atom+xml" title="${escapeAttribute(site.name)}" href="${escapeAttribute(feed)}">`)
  if (meta.structured?.length && site.url && !has(/application\/ld\+json/i)) {
    const picture = pagePicture ? site.url + pagePicture : undefined
    tags.push(jsonLdTag(meta.structured.map((item) => (picture && (item['@type'] === 'BlogPosting' || item['@type'] === 'Event') && !item.image ? { ...item, image: picture } : item))))
  }
  if (extra.themeColor && !has(/<meta[^>]+name=["']theme-color["']/i)) tags.push(`<meta name="theme-color" content="${escapeAttribute(extra.themeColor)}">`)
  if (tags.length === 0) return `${head}${html.slice(close.index)}`
  return `${head}  ${tags.join('\n  ')}\n${html.slice(close.index)}`
}

/** The first real paragraph of a page's main part, for a page whose layout has no slot a description is taken from. */
function firstParagraph(html: string): string {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? ''
  for (const paragraph of main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    if (/<img\b/i.test(paragraph[1])) continue
    const text = describe(paragraph[1])
    if (text.length >= 40) return text
  }
  return ''
}

/** A title that already says the site's name does not get it again: "Ping Pong Beisl at SchloR · SchloR" is "Ping Pong Beisl at SchloR". */
function withoutRepeatedName(head: string, name: string): string {
  if (!name) return head
  const wanted = name.toLowerCase()
  return head.replace(/<title>([\s\S]*?)<\/title>/i, (whole, text: string) => {
    const split = /^([\s\S]*?)\s+[·|–—-]\s+([^·|–—-]*)$/.exec(text.trim())
    if (!split || split[2].trim().toLowerCase() !== wanted || !split[1].toLowerCase().includes(wanted)) return whole
    return `<title>${split[1].trim()}</title>`
  })
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

export function sitemapXml(site: { url: string }, paths: string[], modified: Record<string, string> = {}): string {
  const urls = [...new Set(paths)].sort().map((urlPath) => `  <url><loc>${escapeAttribute(site.url + urlPath)}</loc>${modified[urlPath] ? `<lastmod>${modified[urlPath]}</lastmod>` : ''}</url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

export function robotsTxt(site: { url?: string }): string {
  return `User-agent: *\nAllow: /\n${site.url ? `\nSitemap: ${site.url}/sitemap.xml\n` : ''}`
}
