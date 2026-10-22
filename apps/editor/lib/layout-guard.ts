import { listPageSlugs, readPage, readSiteConfig } from '@schlor/generator'

export type NamedPage = { slug: string; titles: string[] }

/** Every page with its slug and its title in each language. A design file must not name one. */
export function namedPages(root: string): NamedPage[] {
  readSiteConfig(root)
  return listPageSlugs(root).flatMap((slug) => {
    const page = readPage(root, slug)
    if (!page) return []
    return [{ slug, titles: Object.values(page.title).map((title) => title.trim()).filter(Boolean) }]
  })
}

function kind(rel: string): 'template' | 'style' | null {
  const normalized = rel.replaceAll('\\', '/')
  if (normalized === 'shell.njk' || /^layouts\/[^/]+\/template\.njk$/.test(normalized)) return 'template'
  if (normalized === 'styles.css' || /^layouts\/[^/]+\/style\.css$/.test(normalized)) return 'style'
  return null
}

/**
 * Why a design file may not be written, or null. A template holds no visible words of its own: page text
 * comes from a slot and interface text from a label. No design file names one page or holds a picture address.
 */
export function designContentRefusal(rel: string, content: string, pages: NamedPage[]): string | null {
  const normalized = rel.replaceAll('\\', '/')
  const type = kind(normalized)
  if (!type) return null
  const named = pages.filter((page) => namesPage(content, page))
  if (named.length > 0) {
    const list = named.map((page) => `${page.titles[0] ?? page.slug} (${page.slug})`).join(', ')
    return `design/${normalized} names ${list}. A design file serves many pages. Remove the name. Give that page its own layout if it needs its own look.`
  }
  if (/\/media\//.test(content)) {
    return `design/${normalized} holds a picture address. Put the picture on the page in an image slot, and show it with {{ slots.name }}. A design file keeps the structure and the look.`
  }
  const external = externalResource(content, type)
  if (external) {
    return `design/${normalized} loads ${external} from another host. A visitor's browser would contact it and send their address to a third party, which this site does not allow. Keep the file in the site: save_picture for a picture, add_font for a font. A plain link to another site is fine.`
  }
  if (type === 'style') {
    const text = cssText(content)
    return text ? `design/${normalized} holds text in a content rule (“${text}”). Words belong in a slot or a label.` : null
  }
  const text = visibleText(content)
  if (text) {
    return `design/${normalized} holds the text “${text}”. Show page text with a slot ({{ slots.name }}). Show interface text with a label: add it to design/labels.yml in each language, then use {{ labels.name }}.`
  }
  return null
}

function namesPage(content: string, page: NamedPage): boolean {
  const hay = content.toLowerCase()
  const slug = page.slug.toLowerCase()
  if (slug.length >= 4 && slug !== 'home' && hasToken(hay, slug)) return true
  if (slug.length >= 8 && hasToken(hay, slug.slice(0, -1))) return true
  return page.titles.some((title) => {
    const lower = title.toLowerCase()
    return lower.length >= 8 && hay.includes(lower)
  })
}

function hasToken(hay: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(hay)
}

const EXTERNAL = /^\s*(?:https?:)?\/\//i
const LINK_THAT_DOES_NOT_LOAD = /\b(?:canonical|alternate|author|license|me|next|prev|help)\b/i

function cssExternal(css: string): string | null {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const url = /url\(\s*(["']?)\s*((?:https?:)?\/\/[^)"'\s]+)/i.exec(stripped)
  if (url) return url[2]
  const imported = /@import\s+["']\s*((?:https?:)?\/\/[^"'\s]+)/i.exec(stripped)
  return imported ? imported[1] : null
}

/** An address on another host that a file would load: a stylesheet, script, font, picture, video, or frame. A link is not a load. */
export function externalResource(content: string, kind: 'template' | 'style'): string | null {
  if (kind === 'style') return cssExternal(content)
  const template = content.replace(/\{#[\s\S]*?#\}/g, '')
  for (const block of template.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const found = cssExternal(block[1])
    if (found) return found
  }
  for (const tag of template.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const name = tag[1].toLowerCase()
    const attrs = tag[2]
    const value = (attribute: string) => new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(attrs)?.[2]
    const style = value('style')
    if (style) {
      const found = cssExternal(style)
      if (found) return found
    }
    const loading: string[] = []
    if (['img', 'script', 'iframe', 'video', 'audio', 'source', 'track', 'embed', 'object', 'input'].includes(name)) loading.push('src', 'srcset', 'data', 'poster')
    if (name === 'video') loading.push('poster')
    if (name === 'link' && !LINK_THAT_DOES_NOT_LOAD.test(value('rel') ?? '')) loading.push('href')
    if (name === 'image' || name === 'use') loading.push('href', 'xlink:href')
    for (const attribute of loading) {
      const found = value(attribute)
      if (!found || found.includes('{{')) continue
      const first = found.split(',').map((part) => part.trim().split(/\s+/)[0]).find((url) => EXTERNAL.test(url))
      if (first) return first
    }
  }
  return null
}

const READER_ATTRIBUTES = ['alt', 'title', 'aria-label', 'placeholder', 'value']
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }

const hasLetter = (value: string) => /\p{L}/u.test(value)

function cssText(css: string): string | null {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of stripped.matchAll(/\bcontent\s*:\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    if (hasLetter(match[2].replace(/\\[0-9a-f]{1,6}\s?/gi, ''))) return match[2].slice(0, 40)
  }
  return null
}

/** The first visible words of a template: text between tags, reader attributes, and capitalised literals in tags. */
export function visibleText(template: string): string | null {
  const withoutComments = template.replace(/\{#[\s\S]*?#\}/g, ' ')
  const chunks = [...htmlChunks(withoutComments), ...readerAttributeValues(withoutComments), ...nunjucksLiterals(withoutComments)]
  for (const chunk of chunks) {
    if (hasLetter(chunk)) return chunk.replace(/\s+/g, ' ').trim().slice(0, 60)
  }
  return null
}

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&[a-z]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
}

function htmlChunks(template: string): string[] {
  const stripped = template
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\{%[\s\S]*?%\}/g, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
  return stripped
    .split(/<[^>]*>/)
    .map((chunk) => decode(chunk).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function readerAttributeValues(template: string): string[] {
  const values: string[] = []
  const tags = template.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  for (const tag of tags.matchAll(/<[a-z][^>]*>/gi)) {
    for (const name of READER_ATTRIBUTES) {
      const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, 'i')
      const value = pattern.exec(tag[0].replace(/\{\{[\s\S]*?\}\}/g, '').replace(/\{%[\s\S]*?%\}/g, ''))?.[2]
      if (value) values.push(decode(value))
    }
  }
  return values
}

// A literal in a Nunjucks tag that starts with a capital letter is a word. Class names and ids do not.
function nunjucksLiterals(template: string): string[] {
  const values: string[] = []
  for (const block of template.matchAll(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g)) {
    if (/^\{%-?\s*(?:extends|include|import|from|block|endblock|set\s+\w+\s*=\s*['"]\s*['"])/.test(block[0])) continue
    for (const literal of block[0].matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const text = literal[2]
      if (/^\p{Lu}\p{L}/u.test(text) || (/\s/.test(text.trim()) && /[^\x00-\x7f]/.test(text) && hasLetter(text))) values.push(text)
    }
  }
  return values
}

export function guardDesignWrite(root: string, rel: string, content: string): string | null {
  return designContentRefusal(rel, content, namedPages(root))
}
