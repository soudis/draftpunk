import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import MarkdownIt from 'markdown-it'
import multimdTable from 'markdown-it-multimd-table'
import sanitizeHtml from 'sanitize-html'
import { parse, stringify } from 'yaml'
import { languageIds, requiredLanguages } from './model'

export type Lang = string

export const REQUIRED_LAYOUTS = ['event', 'calendar', 'archive'] as const

const markdown = new MarkdownIt({ html: true, linkify: true, typographer: true }).use(multimdTable as never)

const ALLOWED_TAGS = [
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'code',
  'pre',
]

export type ContentBlock = { start: number; end: number; text: string }

export function contentBlocks(source: string): ContentBlock[] {
  const lineStarts = [0]
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') lineStarts.push(i + 1)
  }
  const blocks: ContentBlock[] = []
  for (const token of markdown.parse(source, {})) {
    if (token.level !== 0 || !token.map || token.nesting === -1) continue
    const start = lineStarts[token.map[0]] ?? source.length
    const end = token.map[1] >= lineStarts.length ? source.length : lineStarts[token.map[1]]
    if (blocks.some((block) => start < block.end && end > block.start)) continue
    const text = source.slice(start, end)
    if (!text.trim()) continue
    blocks.push({ start, end, text })
  }
  if (blocks.length === 0 && source.trim()) return [{ start: 0, end: source.length, text: source }]
  return blocks
}

export type VisibleText = { text: string; start: number[]; end: number[] }

type MdToken = {
  type: string
  content: string
  markup: string
  children: MdToken[] | null
  level?: number
  map?: [number, number] | null
}

const TYPO: Array<[string, string]> = [
  ['...', '…'],
  ['---', '—'],
  ['--', '–'],
  ['(c)', '©'],
  ['(C)', '©'],
  ['(r)', '®'],
  ['(R)', '®'],
  ['(tm)', '™'],
  ['(TM)', '™'],
  ['(p)', '§'],
  ['(P)', '§'],
  ['+-', '±'],
]

export function listItemSlices(source: string): ContentBlock[] {
  const lineStarts = lineIndex(source)
  const items: ContentBlock[] = []
  for (const token of markdown.parse(source, {}) as MdToken[]) {
    if (token.type !== 'list_item_open' || token.level !== 1 || !token.map) continue
    const start = lineStarts[token.map[0]] ?? source.length
    const end = token.map[1] >= lineStarts.length ? source.length : lineStarts[token.map[1]]
    const text = source.slice(start, end)
    if (text.trim()) items.push({ start, end, text })
  }
  return items
}

export function markdownVisible(source: string): VisibleText {
  const start: number[] = []
  const end: number[] = []
  let text = ''
  let cursor = 0
  const pushRanges = (value: string, ranges: Array<[number, number]>, base: number) => {
    for (let i = 0; i < value.length; i += 1) {
      const range = ranges[i] ?? ranges[ranges.length - 1] ?? [0, 0]
      text += value[i]
      start.push(base + range[0])
      end.push(base + range[1])
    }
  }
  const walk = (tokens: MdToken[]) => {
    for (const token of tokens) {
      if (token.type === 'inline' && token.children) {
        const at = token.content ? source.indexOf(token.content, cursor) : cursor
        if (at >= 0) {
          consumeInline(token.content, token.children, at, pushRanges)
          cursor = at + token.content.length
        }
        continue
      }
      if (token.type === 'html_block') {
        const at = source.indexOf(token.content, cursor)
        if (at >= 0) {
          htmlVisible(token.content, at, pushRanges)
          cursor = at + token.content.length
        }
        continue
      }
      if (token.children) walk(token.children)
    }
  }
  walk(markdown.parse(source, {}) as MdToken[])
  return { text, start, end }
}

function lineIndex(source: string): number[] {
  const lineStarts = [0]
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') lineStarts.push(i + 1)
  }
  return lineStarts
}

function consumeInline(
  raw: string,
  tokens: MdToken[],
  base: number,
  pushRanges: (value: string, ranges: Array<[number, number]>, base: number) => void,
): void {
  let cursor = 0
  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'code_inline') {
      if (token.type === 'code_inline' && raw[cursor] === '`') {
        const open = raw.indexOf(token.content, cursor)
        cursor = open < 0 ? cursor : open
      }
      const matched = matchAhead(raw, cursor, token.content)
      if (!matched) continue
      pushRanges(matched.visible, matched.ranges, base)
      cursor = matched.end
      if (token.type === 'code_inline' && raw[cursor] === '`') cursor += 1
      continue
    }
    if (token.type === 'softbreak' || token.type === 'hardbreak') {
      const nl = raw.indexOf('\n', cursor)
      if (nl >= 0) {
        pushRanges('\n', [[nl, nl + 1]], base)
        cursor = nl + 1
      }
      continue
    }
    if (token.type === 'html_inline') {
      const at = raw.indexOf(token.content, cursor)
      if (at >= 0) {
        htmlVisible(token.content, base + at, pushRanges)
        cursor = at + token.content.length
      }
      continue
    }
    if (token.type === 'image') {
      const close = raw.indexOf(')', cursor)
      cursor = close < 0 ? raw.length : close + 1
      continue
    }
    if (token.type === 'link_open') {
      if (raw[cursor] === '[') cursor += 1
      else if (raw[cursor] === '<') cursor += 1
      continue
    }
    if (token.type === 'link_close') {
      if (raw[cursor] === '>') cursor += 1
      else if (raw[cursor] === ']') {
        const close = raw.indexOf(')', cursor)
        cursor = close < 0 ? cursor + 1 : close + 1
      }
      continue
    }
    if (token.markup && raw.startsWith(token.markup, cursor)) cursor += token.markup.length
    else if (token.children) consumeInline(raw.slice(cursor), token.children, base + cursor, pushRanges)
  }
}

function matchAhead(raw: string, from: number, visible: string): { end: number; visible: string; ranges: Array<[number, number]> } | null {
  if (!visible) return { end: from, visible: '', ranges: [] }
  const limit = Math.min(raw.length, from + visible.length + 8)
  for (let i = from; i <= limit; i += 1) {
    const matched = matchVisible(raw, i, visible)
    if (matched) return matched
  }
  return null
}

function matchVisible(raw: string, from: number, visible: string): { end: number; visible: string; ranges: Array<[number, number]> } | null {
  const ranges: Array<[number, number]> = []
  let i = from
  let v = 0
  while (v < visible.length) {
    const step = readSourceChar(raw, i, visible, v)
    if (!step) return null
    for (let n = 0; n < step.visible.length; n += 1) ranges.push([i, step.next])
    v += step.visible.length
    i = step.next
  }
  return { end: i, visible, ranges }
}

function readSourceChar(raw: string, i: number, visible: string, v: number): { next: number; visible: string } | null {
  if (i >= raw.length) return null
  if (raw[i] === '\\' && i + 1 < raw.length && raw[i + 1] === visible[v]) return { next: i + 2, visible: visible[v] }
  if (raw[i] === '&') {
    const semi = raw.indexOf(';', i)
    if (semi > i && semi - i <= 12) {
      const decoded = decodeEntity(raw.slice(i, semi + 1))
      if (decoded && visible.startsWith(decoded, v)) return { next: semi + 1, visible: decoded }
    }
  }
  for (const [source, rendered] of TYPO) {
    if (raw.startsWith(source, i) && visible.startsWith(rendered, v)) return { next: i + source.length, visible: rendered }
  }
  if (raw[i] === visible[v]) return { next: i + 1, visible: visible[v] }
  return null
}

function decodeEntity(entity: string): string | null {
  if (entity === '&amp;') return '&'
  if (entity === '&lt;') return '<'
  if (entity === '&gt;') return '>'
  if (entity === '&quot;') return '"'
  if (entity === '&#39;' || entity === '&apos;') return "'"
  if (entity === '&nbsp;') return '\u00A0'
  const decimal = /^&#(\d+);$/.exec(entity)
  if (decimal) return String.fromCodePoint(Number(decimal[1]))
  const hex = /^&#x([0-9a-f]+);$/i.exec(entity)
  if (hex) return String.fromCodePoint(Number.parseInt(hex[1], 16))
  return null
}

function htmlVisible(
  html: string,
  base: number,
  pushRanges: (value: string, ranges: Array<[number, number]>, base: number) => void,
): void {
  let i = 0
  while (i < html.length) {
    const lower = html.slice(i, i + 8).toLowerCase()
    if (lower.startsWith('<script') || lower.startsWith('<style')) {
      const name = lower.startsWith('<script') ? 'script' : 'style'
      const endTag = html.toLowerCase().indexOf(`</${name}>`, i)
      i = endTag < 0 ? html.length : endTag + name.length + 3
      continue
    }
    if (html[i] === '<') {
      const close = html.indexOf('>', i)
      i = close < 0 ? html.length : close + 1
      continue
    }
    if (html[i] === '&') {
      const semi = html.indexOf(';', i)
      const decoded = semi > i && semi - i <= 12 ? decodeEntity(html.slice(i, semi + 1)) : null
      if (decoded) {
        pushRanges(decoded, decoded.split('').map(() => [i, semi + 1] as [number, number]), base)
        i = semi + 1
        continue
      }
    }
    pushRanges(html[i], [[i, i + 1]], base)
    i += 1
  }
}

export function renderContent(source: string): string {
  return sanitizeHtml(markdown.render(source), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  })
}

export type PageDoc = {
  slug: string
  lang: Lang
  layout: string
  title: string
  date?: string
  body: string
  data: Record<string, unknown>
}

export function readPageFile(file: string, slug: string, lang: Lang): PageDoc {
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>
  const layout = String(data.layout ?? 'article')
  const title = String(data.title ?? slug)
  const date = data.date ? String(data.date).slice(0, 10) : undefined
  return { slug, lang, layout, title, date, body: parsed.content, data }
}

export function writePageFile(
  file: string,
  doc: Pick<PageDoc, 'layout' | 'title' | 'date' | 'body'> & { data?: Record<string, unknown> },
): void {
  const data = defined({ ...(doc.data ?? {}) }) as Record<string, unknown>
  delete data.layout
  delete data.title
  delete data.date
  data.layout = doc.layout
  data.title = doc.title
  if (doc.date) data.date = doc.date
  const front = matter.stringify(doc.body.trim() + '\n', data)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, front)
}

function defined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(defined)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = defined(item)
    }
    return out
  }
  return value
}

export function readYaml<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback
  return parse(fs.readFileSync(file, 'utf8')) as T
}

export function writeYaml(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, stringify(value))
}

export function listLayoutNames(designDir: string): string[] {
  const dir = path.join(designDir, 'layouts')
  if (!fs.existsSync(dir)) return []
  const names = new Set<string>()
  for (const name of fs.readdirSync(dir)) {
    const match = /^(.+)\.(?:njk|yml)$/.exec(name)
    if (match?.[1]) names.add(match[1])
  }
  return [...names].sort()
}

export function pageLayouts(designDir: string): string[] {
  const required = new Set<string>(REQUIRED_LAYOUTS)
  return listLayoutNames(designDir).filter((name) => !required.has(name))
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/

export function assertSlug(slug: string): void {
  if (!SLUG.test(slug)) throw new Error(`Slug must be lowercase words: ${slug}`)
}

export function assertInside(root: string, target: string): void {
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the site: ${target}`)
  }
}

export function listPageSlugs(root: string): string[] {
  const base = path.join(root, 'content', 'pages')
  const slugs: string[] = []
  const walk = (dir: string, slug: string) => {
    if (!fs.existsSync(dir)) return
    const languages = new Set(languageIds(root))
    const hasDoc = fs.readdirSync(dir).some((name) => {
      const match = /^([a-z]{2}(?:-[a-z0-9]+)*)\.md$/.exec(name)
      return Boolean(match && languages.has(match[1]))
    })
    if (slug && hasDoc) slugs.push(slug)
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), slug ? `${slug}/${entry.name}` : entry.name)
    }
  }
  walk(base, '')
  return slugs.sort()
}

export function contentPagePath(root: string, slug: string, lang: Lang): string {
  assertSlug(slug)
  const file = path.join(root, 'content', 'pages', slug, `${lang}.md`)
  assertInside(root, file)
  return file
}

export function designFilePath(root: string, rel: string): string {
  const normalized = rel.replaceAll('\\', '/')
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error(`Design path is not allowed: ${rel}`)
  }
  const allowed =
    normalized === 'brief.md' ||
    normalized === 'styles.css' ||
    normalized === 'shell.njk' ||
    normalized === 'nav.yml' ||
    normalized === 'categories.yml' ||
    normalized === 'site.yml' ||
    normalized === 'fields.yml' ||
    normalized === 'setup.yml' ||
    normalized === 'proposal.yml' ||
    /^layouts\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:njk|yml)$/.test(normalized)
  if (!allowed) throw new Error(`Design path is not allowed: ${rel}`)
  const file = path.join(root, 'design', normalized)
  assertInside(path.join(root, 'design'), file)
  return file
}

export type EventDoc = {
  slug: string
  title: Record<string, string>
  body: Record<string, string>
  place: string
  categories: string[]
  fields?: Record<string, string>
  dates: { start: string; end?: string }[]
}

export type PlaceDoc = {
  slug: string
  name: Record<string, string>
  address?: string
  onPremises: boolean
}

export function bilingualGaps(root: string): string[] {
  const gaps: string[] = []
  const required = requiredLanguages(root)
  for (const slug of listPageSlugs(root)) {
    for (const lang of required) {
      const file = contentPagePath(root, slug, lang)
      if (!fs.existsSync(file) || readPageFile(file, slug, lang).body.trim().length === 0) {
        gaps.push(`page ${slug} ${lang}`)
      }
    }
  }
  const eventsDir = path.join(root, 'content', 'events')
  if (fs.existsSync(eventsDir)) {
    for (const name of fs.readdirSync(eventsDir).filter((n) => n.endsWith('.yml'))) {
      const event = readYaml<EventDoc>(path.join(eventsDir, name), {
        slug: name,
        title: {},
        body: {},
        place: '',
        categories: [],
        dates: [],
      })
      for (const lang of required) {
        if (!event.title[lang]?.trim() || !event.body[lang]?.trim()) gaps.push(`event ${name} ${lang}`)
      }
    }
  }
  return gaps
}
