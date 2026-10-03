export type NavLabel = { de: string; en: string }
export type NavNode = { href: string; label: NavLabel; children?: NavNode[] }
export type ImageField = { src: string; caption?: string }
export type CardField = { title: string; href: string; text?: string; image?: string }
export type BandField = { title: string; text?: string; href?: string; image?: string }
export type GalleryItem = { href: string; src?: string; label?: string }
export type GalleryGroup = { title: string; items: GalleryItem[] }
export type LinkGroup = { title: string; links: { href: string; label: string }[] }

const ENGLISH: Record<string, string> = {
  'Über uns': 'About',
  'Wer wir sind': 'Who we are',
  Organisation: 'Organisation',
  Rechtsstruktur: 'Legal structure',
  Finanzierung: 'Financing',
  'Unser Grundstück': 'The site',
  Betriebe: 'The businesses',
  Bauphasen: 'Building phases',
  'Informationen zur Zugänglichkeit': 'Accessibility',
  Anfahrt: 'Getting here',
  Mitmachen: 'Get involved',
  Direktkredite: 'Direct loans',
  Kalender: 'Calendar',
  Newsletter: 'Newsletter',
  Betriebswohnungen: 'Housing',
  Ateliers: 'Studios',
  'Proberäume und Tonstudio': 'Rehearsal rooms and studio',
  Seminarraum: 'Seminar room',
  Veranstaltungsraum: 'Event room',
  Werkstatt: 'Workshop',
  Impressum: 'Imprint',
  Datenschutz: 'Privacy',
  Kontakt: 'Contact',
  Presse: 'Press',
  Material: 'Material',
}

export function localHref(href: string): string {
  if (href.startsWith('mailto:') || href.startsWith('#') || href.startsWith('/media/')) return href
  let url: URL
  try {
    url = new URL(href, 'https://schlor.org')
  } catch {
    return href
  }
  const host = url.hostname.replace(/^www\./, '')
  if (host !== 'schlor.org') return href
  let pathname = url.pathname
  const redirects: Record<string, string> = {
    '/schlor/finanzierung': '/finanzierung/',
    '/schlor/finanzierung/': '/finanzierung/',
    '/home/bauphasen': '/bauphasen/',
    '/home/bauphasen/': '/bauphasen/',
    '/home/direktkredite': '/direktkredite/',
    '/home/direktkredite/': '/direktkredite/',
    '/home/ueber-uns': '/ueber-uns/',
    '/home/ueber-uns/': '/ueber-uns/',
    '/home-2': '/',
    '/home-2/': '/',
    '/home': '/',
    '/home/': '/',
  }
  pathname = redirects[pathname] ?? pathname
  if (pathname !== '/' && !pathname.endsWith('/')) pathname = `${pathname}/`
  return `${pathname}${url.hash}`
}

export function rewriteLinks(markdown: string): string {
  const withBare = markdown.replace(/(?<!@)(?:https?:\/\/)?(?:www\.)?schlor\.org(\/[^\s)]*)?/g, (url) => {
    const trimmed = url.replace(/[.,!?;:]+$/g, '')
    const rest = url.slice(trimmed.length)
    const absolute = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
    return `${localHref(absolute)}${rest}`
  })
  return withBare.replace(/\]\(([^)]+)\)/g, (_full, href: string) => `](${localHref(href)})`)
}

export function parseMenus(html: string): { menu: NavNode[]; footer: NavNode[] } {
  return {
    menu: listItems(slice(html, 'id="mainnav"', '</nav>')),
    footer: listItems(slice(html, 'id="menu-website"', '</ul>')).map((item) => ({ href: item.href, label: item.label })),
  }
}

export function heroImage(html: string): string | undefined {
  const match = html.match(/<img\b[^>]*class="mobile-slide[^"]*"[^>]*>/i)
  return match ? bestSrc(match[0]) : undefined
}

export function upgradeImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const best = bestSrc(tag)
    const withSrc = best ? tag.replace(/\ssrc="[^"]*"/i, ` src="${best}"`) : tag
    return withSrc.replace(/\ssrcset="[^"]*"/i, '').replace(/\ssizes="[^"]*"/i, '')
  })
}

export function logoImage(html: string): string | undefined {
  const match = html.match(/class="site-logo"[^>]*src="([^"]+)"/)
  return match?.[1]
}

export type StructuredPage = {
  body: string
  data: Record<string, unknown>
}

export function structureHtml(
  layout: string,
  html: string,
  toMarkdown: (html: string) => string,
): StructuredPage {
  const prepared = html.replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  if (layout === 'home') return structureHome(prepared, toMarkdown)
  if (layout === 'room') return structureRoom(prepared, toMarkdown)
  if (layout === 'gallery') return structureGallery(prepared, toMarkdown)
  if (layout === 'allies') return structureAllies(prepared, toMarkdown)
  return { body: tidy(rewriteLinks(toMarkdown(prepared))), data: {} }
}

function structureHome(html: string, toMarkdown: (html: string) => string): StructuredPage {
  const sections = splitBy(html, /<h1\b[^>]*>/i).filter((section) => /<h1\b/i.test(section))
  const intro = sections[0] ?? html
  const lede = textOf(intro.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? '')
  const bandSection = sections.find((section) => /Direktkredit|Freund/i.test(`${headingText(section, 'h1')} ${headingText(section, 'h4')}`)) ?? ''
  const business = sections.find((section) => /Betriebe/i.test(headingText(section, 'h1'))) ?? ''
  const cards = splitBy(business, /<h2\b[^>]*>/i)
    .map((section) => cardFrom(section))
    .filter((card): card is CardField => Boolean(card))
  if (!cards.some((card) => card.href.includes('/wohnen'))) {
    const wohnen: CardField = { title: 'Wohnen', href: '/wohnen/', text: 'Betriebswohnungen.' }
    const trap = cards.findIndex((card) => /trap|circus/i.test(`${card.href} ${card.title}`))
    if (trap >= 0) cards.splice(trap, 0, wohnen)
    else cards.push(wohnen)
  }
  const bandTitle = textOf(bandSection.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
  const bandLede = textOf(bandSection.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? '')
  const introHtml = intro.replace(/<h1\b[\s\S]*?<\/h1>/i, '').replace(/<h4\b[\s\S]*?<\/h4>/i, '')
  return {
    body: tidy(rewriteLinks(toMarkdown(introHtml))),
    data: {
      hero: { lede, image: firstImage(intro) },
      cards,
      band: {
        title: bandTitle,
        text: [bandLede, ...paragraphs(bandSection)].filter(Boolean).join(' '),
        href: '/direktkredite/',
        image: firstImage(bandSection),
      },
    },
  }
}

function structureRoom(html: string, toMarkdown: (html: string) => string): StructuredPage {
  const images = preferredImages([...html.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/gi)].map((match) => ({
    src: match[1],
    caption: match[0].match(/alt="([^"]*)"/)?.[1] ?? '',
  }))).slice(0, 8)
  const email = html.match(/mailto:([^"'\s>]+)/)?.[1]
  const withoutImages = html.replace(/<img\b[^>]*>/gi, '')
  return {
    body: tidy(rewriteLinks(toMarkdown(withoutImages))),
    data: { images: images.map((image) => ({ src: image.src, caption: image.caption || undefined })), email },
  }
}

function structureGallery(html: string, toMarkdown: (html: string) => string): StructuredPage {
  const tag = groupTag(html)
  const groups = headingGroups(html, tag).map((group) => ({
    title: group.title,
    items: itemsIn(group.html),
  })).filter((group) => group.items.length > 0)
  const intro = html.split(new RegExp(`<${tag}\\b`, 'i'))[0] ?? ''
  return { body: tidy(rewriteLinks(toMarkdown(intro.replace(/<img\b[^>]*>/gi, '')))), data: { groups } }
}

function structureAllies(html: string, toMarkdown: (html: string) => string): StructuredPage {
  const tag = groupTag(html)
  const groups = headingGroups(html, tag).map((group) => ({
    title: group.title,
    links: allyLinks(group.html),
  })).filter((group) => group.links.length > 0)
  const intro = html.split(new RegExp(`<${tag}\\b`, 'i'))[0] ?? ''
  return { body: tidy(rewriteLinks(toMarkdown(intro))), data: { groups } }
}

function groupTag(html: string): string {
  if (/<h2\b/i.test(html)) return 'h2'
  if (/<h3\b/i.test(html)) return 'h3'
  return 'h4'
}

function cardFrom(section: string): CardField | undefined {
  const title = textOf(section.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? '')
  if (!title) return undefined
  const href = localHref(section.match(/<a\b[^>]*href="([^"]+)"/i)?.[1] ?? '')
  const text = paragraphs(section).join(' ')
  return { title, href, text, image: firstImage(section) }
}

function itemsIn(html: string): GalleryItem[] {
  const images: { src: string; caption: string }[] = []
  const files: GalleryItem[] = []
  const seen = new Set<string>()
  for (const figure of html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const block = figure[1]
    const href = block.match(/<a\b[^>]*href=['"]([^'"]+)['"]/i)?.[1]
    const img = block.match(/<img\b[^>]*src=['"]([^'"]+)['"]/i)?.[1]
    const linked = href && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(href) && !/\/elementor\/thumbs\//.test(href) ? href : undefined
    const src = linked ?? img
    if (!src || /\/elementor\/thumbs\//.test(src) || seen.has(src)) continue
    seen.add(src)
    const caption = textOf(block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? '')
    images.push({ src, caption })
  }
  for (const match of html.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/gi)) {
    if (seen.has(match[1]) || /\/elementor\/thumbs\//.test(match[1])) continue
    seen.add(match[1])
    images.push({ src: match[1], caption: match[0].match(/alt="([^"]*)"/)?.[1] ?? '' })
  }
  for (const image of preferredImages(images)) {
    files.push({ src: image.src, href: image.src, label: image.caption || undefined })
    seen.add(image.src)
  }
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (/<img\b/i.test(match[2])) continue
    const href = localHref(match[1])
    if (seen.has(href)) continue
    if (!/\.(pdf|zip|docx?|png|jpe?g)(\?|$)/i.test(href) && !href.startsWith('/media/')) continue
    seen.add(href)
    files.push({ href, label: textOf(match[2]) || href })
  }
  return files
}

function allyLinks(html: string): { href: string; label: string; image?: string }[] {
  const links: { href: string; label: string; image?: string }[] = []
  const seen = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = localHref(match[1])
    if (!href || href.startsWith('#') || seen.has(href)) continue
    const img = match[2].match(/<img\b[^>]*>/i)?.[0]
    const image = img ? bestSrc(img) : undefined
    let label = textOf(match[2])
    if (!label && img) label = img.match(/\salt="([^"]*)"/i)?.[1]?.trim() ?? ''
    if (!label) label = hostLabel(href)
    if (!label && !image) continue
    seen.add(href)
    links.push({ href, label, image })
  }
  return links
}

function headingGroups(html: string, tag: string): { title: string; html: string }[] {
  const parts = html.split(new RegExp(`(?=<${tag}\\b)`, 'i')).filter((part) => new RegExp(`^\\s*<${tag}\\b`, 'i').test(part))
  return parts.map((part) => ({
    title: textOf(part.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? ''),
    html: part,
  })).filter((part) => part.title)
}

function preferredImages(images: { src: string; caption: string }[]): { src: string; caption: string }[] {
  const byStem = new Map<string, { src: string; caption: string }>()
  for (const image of images) {
    const name = image.src.split('/').pop() ?? image.src
    const stem = name.replace(/-\d+x\d+(?=\.)/, '')
    const current = byStem.get(stem)
    if (!current || /-\d+x\d+\./.test(current.src)) byStem.set(stem, image)
  }
  return [...byStem.values()]
}

function firstImage(html: string): string | undefined {
  return preferredImages([...html.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/gi)].map((match) => ({ src: match[1], caption: '' })))[0]?.src
}

function splitBy(html: string, pattern: RegExp): string[] {
  return html.split(new RegExp(`(?=${pattern.source})`, pattern.flags)).filter((part) => part.trim())
}

function slice(html: string, start: string, end: string): string {
  const from = html.indexOf(start)
  if (from < 0) return ''
  const to = html.indexOf(end, from)
  return html.slice(from, to < 0 ? undefined : to)
}

function listItems(html: string): NavNode[] {
  return liBlocks(html).map((block) => {
    const link = block.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    const nested = block.match(/<ul\b[^>]*>([\s\S]*)<\/ul>/i)
    const label = textOf(link?.[2] ?? '')
    const node: NavNode = { href: localHref(link?.[1] ?? ''), label: { de: label, en: ENGLISH[label] ?? label } }
    if (nested) node.children = listItems(nested[1])
    return node
  }).filter((item) => item.label.de && item.href)
}

function liBlocks(html: string): string[] {
  const blocks: string[] = []
  const re = /<li\b[^>]*>|<\/li>/g
  let depth = 0
  let start = -1
  for (let match = re.exec(html); match; match = re.exec(html)) {
    if (match[0].startsWith('<li')) {
      if (depth === 0) start = match.index
      depth += 1
    } else {
      depth -= 1
      if (depth === 0 && start >= 0) blocks.push(html.slice(start, re.lastIndex))
    }
  }
  return blocks
}

function textOf(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_full, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function hostLabel(href: string): string {
  try {
    return new URL(href, 'https://schlor.org').hostname.replace(/^www\./, '')
  } catch {
    return href
  }
}

function headingText(section: string, tag: string): string {
  return textOf(section.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? '')
}

function paragraphs(html: string): string[] {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => rewriteLinks(textOf(match[1])))
    .filter((text) => text.length > 40)
}

function tidy(markdown: string): string {
  return markdown
    .replace(/Ready to begin your journey\??/gi, '')
    .replace(/Feel free to look around/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function bestSrc(tag: string): string | undefined {
  const src = tag.match(/\ssrc="([^"]+)"/i)?.[1]
  const srcset = tag.match(/\ssrcset="([^"]+)"/i)?.[1]
  const candidates: { url: string; width: number }[] = []
  if (src) candidates.push({ url: src, width: widthOf(src) })
  for (const part of srcset?.split(',') ?? []) {
    const [url, size] = part.trim().split(/\s+/)
    if (!url) continue
    const width = size?.endsWith('w') ? Number(size.slice(0, -1)) : widthOf(url)
    candidates.push({ url, width: Number.isFinite(width) ? width : 0 })
  }
  const original = candidates.find((candidate) => !/-\d+x\d+\./.test(candidate.url))
  if (original) return original.url
  return candidates.sort((a, b) => b.width - a.width)[0]?.url
}

function widthOf(url: string): number {
  const match = url.match(/-(\d+)x\d+\./)
  return match ? Number(match[1]) : 10_000
}
