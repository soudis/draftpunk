import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { parseDocument, Scalar } from 'yaml'
import { contentBlocks, listItemSlices, markdownVisible, renderContent } from './content'

const START = '\uE000'
const MID = '\uE001'
const END = '\uE002'
const NOT_IN = 'That text is not in the content.'
const TWICE = 'That phrase appears twice in this text.'
const HINT = 'That hint is not a content field.'

const PAGE_FILE = /^content\/pages\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z]{2}(?:-[a-z0-9]+)*\.md$/
const EVENT_FILE = /^content\/events\/[a-z0-9]+(?:-[a-z0-9]+)*\.yml$/
const PLACE_FILE = /^content\/places\/[a-z0-9]+(?:-[a-z0-9]+)*\.yml$/
const LANG = /^[a-z]{2}(?:-[a-z0-9]+)*$/
const FIELD = /^[A-Za-z][A-Za-z0-9]*(\.(?:[A-Za-z][A-Za-z0-9]*|\d+))*$/
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

export type ContentHint = { file: string; field: string; block?: number; part?: number }

export function plainContent(value: string): string {
  return value.replace(/\uE000[\s\S]*?\uE001/g, '').replaceAll(END, '')
}
export type CorrectionResult = { file: string; changed: boolean } | { error: string }

export function pageContentFile(slug: string, lang: string): string | null {
  const file = `content/pages/${slug}/${lang}.md`
  return PAGE_FILE.test(file) ? file : null
}

export function eventContentFile(slug: string): string | null {
  const file = `content/events/${slug}.yml`
  return EVENT_FILE.test(file) ? file : null
}

export function placeContentFile(slug: string): string | null {
  const file = `content/places/${slug}.yml`
  return PLACE_FILE.test(file) ? file : null
}

export function markContent(text: string, hint: ContentHint): string {
  const clean = text.replaceAll(START, '').replaceAll(MID, '').replaceAll(END, '')
  const payload = hint.block === undefined
    ? `${hint.file}|${hint.field}`
    : hint.part === undefined
      ? `${hint.file}|${hint.field}|${hint.block}`
      : `${hint.file}|${hint.field}|${hint.block}|${hint.part}`
  return `${START}${payload}${MID}${clean}${END}`
}

export function markBody(source: string, file: string, field: string): string {
  return contentBlocks(source)
    .map((block, index) => markBlock(block.text, file, field, index))
    .filter(Boolean)
    .join('\n')
}

function markBlock(source: string, file: string, field: string, index: number): string {
  const html = renderContent(source).trim()
  if (!html) return ''
  const items = listItemSlices(source)
  const lists = html.match(/<(ul|ol)\b/gi)?.length ?? 0
  const lis = html.match(/<li\b/gi)?.length ?? 0
  if (items.length > 1 && lists === 1 && lis === items.length) {
    let part = 0
    return html.replace(/<li(\s[^>]*)?>([\s\S]*?)<\/li>/gi, (_match, attrs: string | undefined, inner: string) => {
      const marked = markContent(trimAscii(inner), { file, field, block: index, part })
      part += 1
      return `<li${attrs ?? ''}>${marked}</li>`
    })
  }
  return markContent(html, { file, field, block: index })
}

function trimAscii(value: string): string {
  return value.replace(/^[ \t\r\n]+/, '').replace(/[ \t\r\n]+$/, '')
}

export function markContentValue(value: unknown, file: string, field: string): unknown {
  if (typeof value === 'string') return value ? markContent(value, { file, field }) : value
  if (Array.isArray(value)) {
    return value.map((item, index) => markContentValue(item, file, `${field}.${index}`))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = markContentValue(item, file, field ? `${field}.${key}` : key)
    }
    return out
  }
  return value
}

export function revealContentHints(html: string): string {
  let out = ''
  let index = 0
  let inTag = false
  let rawText: string | null = null
  while (index < html.length) {
    if (html.startsWith(START, index)) {
      const mid = html.indexOf(MID, index + START.length)
      const end = mid === -1 ? -1 : html.indexOf(END, mid + MID.length)
      if (mid === -1 || end === -1) {
        out += html[index]
        index += 1
        continue
      }
      const payload = html.slice(index + START.length, mid)
      const inner = html.slice(mid + MID.length, end)
      out += inTag || rawText ? inner : attachHint(payload, inner)
      index = end + END.length
      continue
    }
    const ch = html[index]
    if (ch === '<') {
      inTag = true
      const close = html.indexOf('>', index)
      const head = close === -1 ? '' : html.slice(index + 1, close)
      const named = /^(\/?)([A-Za-z][\w:-]*)/.exec(head)
      if (named) {
        const name = named[2].toLowerCase()
        if (!named[1] && (name === 'title' || name === 'script' || name === 'style')) rawText = name
        else if (named[1] && rawText === name) rawText = null
      }
    } else if (ch === '>') inTag = false
    out += ch
    index += 1
  }
  return out
}

export function applyContentCorrection(root: string, hint: string, oldPhrase: string, nextPhrase: string): CorrectionResult {
  if (!oldPhrase.trim() || oldPhrase.length > 4000 || nextPhrase.length > 4000 || hasSentinel(oldPhrase) || hasSentinel(nextPhrase)) {
    return { error: NOT_IN }
  }
  const parsed = parseHint(hint)
  if (!parsed) return { error: HINT }
  const full = insideContent(root, parsed.file)
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return { error: HINT }
  if (PAGE_FILE.test(parsed.file)) return correctPage(full, parsed, oldPhrase, nextPhrase)
  if (EVENT_FILE.test(parsed.file)) return correctEvent(full, parsed, oldPhrase, nextPhrase)
  if (PLACE_FILE.test(parsed.file)) return correctPlace(full, parsed, oldPhrase, nextPhrase)
  return { error: HINT }
}

function correctPage(full: string, hint: ContentHint, oldPhrase: string, nextPhrase: string): CorrectionResult {
  const raw = fs.readFileSync(full, 'utf8')
  if (hint.field === 'body') {
    if (hint.block === undefined) return { error: HINT }
    return correctPageBody(full, hint.file, raw, hint.block, hint.part, oldPhrase, nextPhrase)
  }
  if (hint.block !== undefined) return { error: HINT }
  const regions = pageRegions(raw)
  if (!regions) return { error: HINT }
  const parts = hint.field === 'title' ? ['title'] : fieldPath(hint.field)
  if (!parts || hint.field === 'layout' || hint.field === 'date' || hint.field === 'slug') return { error: HINT }
  return correctScalar(full, hint.file, raw, regions.yaml, regions.yamlStart, parts, undefined, undefined, oldPhrase, nextPhrase, (nextRaw) => pageRegions(nextRaw)?.yaml ?? null)
}

function correctEvent(full: string, hint: ContentHint, oldPhrase: string, nextPhrase: string): CorrectionResult {
  const title = /^title\.([a-z]{2}(?:-[a-z0-9]+)*)$/.exec(hint.field)
  const body = /^body\.([a-z]{2}(?:-[a-z0-9]+)*)$/.exec(hint.field)
  if (title) {
    if (hint.block !== undefined || !LANG.test(title[1])) return { error: HINT }
    return correctDocument(full, hint.file, ['title', title[1]], undefined, undefined, oldPhrase, nextPhrase)
  }
  if (body) {
    if (hint.block === undefined || !LANG.test(body[1])) return { error: HINT }
    return correctDocument(full, hint.file, ['body', body[1]], hint.block, hint.part, oldPhrase, nextPhrase)
  }
  return { error: HINT }
}

function correctPlace(full: string, hint: ContentHint, oldPhrase: string, nextPhrase: string): CorrectionResult {
  if (hint.block !== undefined) return { error: HINT }
  const name = /^name\.([a-z]{2}(?:-[a-z0-9]+)*)$/.exec(hint.field)
  if (name && LANG.test(name[1])) return correctDocument(full, hint.file, ['name', name[1]], undefined, undefined, oldPhrase, nextPhrase)
  if (hint.field === 'address') return correctDocument(full, hint.file, ['address'], undefined, undefined, oldPhrase, nextPhrase)
  return { error: HINT }
}

function correctDocument(
  full: string,
  rel: string,
  parts: (string | number)[],
  block: number | undefined,
  part: number | undefined,
  oldPhrase: string,
  nextPhrase: string,
): CorrectionResult {
  const raw = fs.readFileSync(full, 'utf8')
  return correctScalar(full, rel, raw, raw, 0, parts, block, part, oldPhrase, nextPhrase, (nextRaw) => nextRaw)
}

function correctPageBody(full: string, rel: string, raw: string, block: number, part: number | undefined, oldPhrase: string, nextPhrase: string): CorrectionResult {
  const parsed = matter(raw)
  if (!raw.endsWith(parsed.content)) return { error: HINT }
  const located = locatePhrase(parsed.content, oldPhrase, block, part)
  if ('error' in located) return located
  const expected = parsed.content.slice(0, located.at) + nextPhrase + parsed.content.slice(located.sourceEnd)
  if (expected === parsed.content) return { file: rel, changed: false }
  const nextRaw = raw.slice(0, raw.length - parsed.content.length) + expected
  if (matter(nextRaw).content !== expected) return { error: NOT_IN }
  fs.writeFileSync(full, nextRaw)
  return { file: rel, changed: true }
}

function correctScalar(
  full: string,
  rel: string,
  raw: string,
  yaml: string,
  yamlStart: number,
  parts: (string | number)[],
  block: number | undefined,
  part: number | undefined,
  oldPhrase: string,
  nextPhrase: string,
  yamlOf: (nextRaw: string) => string | null,
): CorrectionResult {
  let node: unknown
  try {
    node = parseDocument(yaml).getIn(parts, true)
  } catch {
    return { error: HINT }
  }
  if (!(node instanceof Scalar) || typeof node.value !== 'string' || !node.range) return { error: HINT }
  const located = locatePhrase(node.value, oldPhrase, block, part)
  if ('error' in located) return located
  const expected = node.value.slice(0, located.at) + nextPhrase + node.value.slice(located.sourceEnd)
  if (expected === node.value) return { file: rel, changed: false }
  const sliceStart = yamlStart + node.range[0]
  const sliceEnd = yamlStart + node.range[1]
  const needle = node.value.slice(located.at, located.sourceEnd)
  const surgical = replaceNth(raw.slice(sliceStart, sliceEnd), needle, nextPhrase, located.occurrence)
  const candidates = [
    surgical == null ? null : raw.slice(0, sliceStart) + surgical + raw.slice(sliceEnd),
    raw.slice(0, sliceStart) + encodeScalar(expected) + raw.slice(sliceEnd),
  ]
  for (const nextRaw of candidates) {
    if (nextRaw == null) continue
    const nextYaml = yamlOf(nextRaw)
    if (nextYaml != null && readPath(nextYaml, parts) === expected) {
      fs.writeFileSync(full, nextRaw)
      return { file: rel, changed: true }
    }
  }
  return { error: NOT_IN }
}

function locatePhrase(source: string, phrase: string, block?: number, part?: number): { at: number; sourceEnd: number; occurrence: number } | { error: string } {
  let start = 0
  let end = source.length
  if (block !== undefined) {
    const found = contentBlocks(source)[block]
    if (!found) return { error: NOT_IN }
    start = found.start
    end = found.end
  }
  let region = source.slice(start, end)
  let regionStart = start
  if (part !== undefined) {
    const item = listItemSlices(region)[part]
    if (!item) return { error: NOT_IN }
    regionStart = start + item.start
    region = item.text
  }
  const visible = block === undefined ? null : markdownVisible(region)
  if (visible) {
    const local = visible.text.indexOf(phrase)
    if (local >= 0) {
      if (visible.text.indexOf(phrase, local + phrase.length) !== -1) return { error: TWICE }
      const at = regionStart + visible.start[local]
      const sourceEnd = regionStart + visible.end[local + phrase.length - 1]
      if (sourceEnd > at) return { at, sourceEnd, occurrence: countBefore(source, source.slice(at, sourceEnd), at) }
    }
  }
  const local = region.indexOf(phrase)
  if (local < 0) return { error: NOT_IN }
  if (region.indexOf(phrase, local + phrase.length) !== -1) return { error: TWICE }
  const at = regionStart + local
  return { at, sourceEnd: at + phrase.length, occurrence: countBefore(source, phrase, at) }
}

function countBefore(source: string, needle: string, at: number): number {
  if (!needle) return 0
  let occurrence = 0
  let from = 0
  while (from < at) {
    const found = source.indexOf(needle, from)
    if (found < 0 || found >= at) break
    occurrence += 1
    from = found + needle.length
  }
  return occurrence
}

function replaceNth(text: string, phrase: string, next: string, index: number): string | null {
  if (!phrase) return null
  let from = 0
  let seen = 0
  while (from <= text.length) {
    const at = text.indexOf(phrase, from)
    if (at < 0) return null
    if (seen === index) return text.slice(0, at) + next + text.slice(at + phrase.length)
    seen += 1
    from = at + phrase.length
  }
  return null
}

function readPath(yaml: string, parts: (string | number)[]): string | null {
  try {
    const doc = parseDocument(yaml)
    if (doc.errors.length > 0) return null
    const value = doc.getIn(parts)
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

function encodeScalar(value: string): string {
  if (value.includes('\n')) {
    const lines = value.replace(/\n$/, '').split('\n').map((line) => `  ${line}`).join('\n')
    return `|-\n${lines}\n`
  }
  if (value === '' || /[:#&*!|>'"%@`,[\]{}?]/.test(value) || /^\s|\s$/.test(value) || /^(true|false|null|yes|no|~)$/i.test(value)) {
    return JSON.stringify(value)
  }
  return value
}

function pageRegions(raw: string): { yamlStart: number; yaml: string } | null {
  if (!raw.startsWith('---\n')) return null
  const close = raw.indexOf('\n---', 4)
  if (close < 0) return null
  return { yamlStart: 4, yaml: raw.slice(4, close) }
}

function fieldPath(field: string): (string | number)[] | null {
  if (!FIELD.test(field) || field === 'title' || field === 'body') return null
  return field.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}

function parseHint(hint: string): ContentHint | null {
  if (!hint || hint.length > 300 || hint.includes('..')) return null
  const parts = hint.split('|')
  if (parts.length < 2 || parts.length > 4) return null
  const [file, field, blockRaw, partRaw] = parts
  if (!file || !field) return null
  if (parts.length === 2) return { file, field }
  if (!blockRaw || !/^\d+$/.test(blockRaw)) return null
  if (parts.length === 3) return { file, field, block: Number(blockRaw) }
  if (!partRaw || !/^\d+$/.test(partRaw)) return null
  return { file, field, block: Number(blockRaw), part: Number(partRaw) }
}

function insideContent(root: string, rel: string): string | null {
  if (rel.startsWith('/') || rel.split('/').includes('..')) return null
  const full = path.resolve(root, rel)
  const fromBase = path.relative(path.resolve(root, 'content'), full)
  if (!fromBase || fromBase.startsWith('..') || path.isAbsolute(fromBase)) return null
  return full
}

function hasSentinel(value: string): boolean {
  return value.includes(START) || value.includes(MID) || value.includes(END)
}

function attachHint(payload: string, inner: string): string {
  const trimmed = trimAscii(inner)
  if (!trimmed) return ''
  const attr = ` data-content="${escapeAttr(payload)}"`
  if (isSingleElement(trimmed)) {
    const close = trimmed.indexOf('>')
    return `${trimmed.slice(0, close)}${attr}${trimmed.slice(close)}`
  }
  const tag = trimmed.startsWith('<') ? 'div' : 'span'
  return `<${tag}${attr}>${trimmed}</${tag}>`
}

function isSingleElement(html: string): boolean {
  const open = /^<([A-Za-z][\w:-]*)\b[^>]*\/?>/.exec(html)
  if (!open) return false
  const name = open[1]
  const lower = name.toLowerCase()
  if (open[0].endsWith('/>') || VOID_TAGS.has(lower)) return open[0].length === html.length
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi')
  let depth = 0
  for (const match of html.matchAll(re)) {
    const raw = match[0]
    if (raw.endsWith('/>')) {
      if (depth === 0) return (match.index ?? 0) === 0 && raw.length === html.length
      continue
    }
    depth += raw.startsWith('</') ? -1 : 1
    if (depth === 0) return (match.index ?? 0) + raw.length === html.length
    if (depth < 0) return false
  }
  return false
}

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}
