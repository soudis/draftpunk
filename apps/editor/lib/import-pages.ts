import path from 'node:path'
import { checkPage, pageUrl, readLayout, readPage, readSiteConfig, readYaml, writePage, writeYaml, type PageFile } from '@schlor/generator'
import { normalizeDescription, stemFromFilename, storePicture } from './pictures'
import { fail } from './tool-kit'

export const MAX_PAGES = 200
export const MAX_PICTURES = 300
export const DEFAULT_BATCH = 12
export const MAX_BATCH = 20

/** How the pages whose address matches go into a layout: which slot takes the text, the first sentence, the first picture. */
export type ImportRule = {
  /** '/news/' or '/news/*' for everything under it, '/about' for one page, '*' for the rest. */
  match: string
  layout: string
  /** The markdown slot that takes the page's text. Default body. */
  body?: string
  /** A text slot that takes the first paragraph. */
  summary?: string
  /** An image slot that takes the first picture. */
  lead?: string
  /** The page is a news item: keep the day it was published. */
  dated?: boolean
}

export type ImportInput = {
  source: string
  rules: ImportRule[]
  /** Source addresses that already became pages in the first pass. */
  skip?: string[]
  limit?: number
  refresh?: boolean
}

export type PageRead = { title: string; markdown: string; date: string }

export type ImportDeps = {
  listPaths(source: string): Promise<{ origin: string; paths: string[]; sitemap: boolean }>
  readPage(url: string): Promise<PageRead>
  fetchPicture(url: string): Promise<{ url: string; body: Uint8Array }>
}

type SourceRecord = { source: string; pages: Record<string, string>; pictures: Record<string, string> }

const UTILITY = /^\/(?:wp-|feed\b|tag\/|category\/|author\/|page\/\d|search\b|cart\b|checkout\b|login\b|account\b|cdn-cgi\b)|\/(?:feed|amp)$/i

export function recordPath(root: string): string {
  return path.join(root, 'content', 'sources.yml')
}

function readRecord(root: string, origin: string): SourceRecord {
  const stored = readYaml<Partial<SourceRecord>>(recordPath(root), {})
  if (stored.source === origin) return { source: origin, pages: stored.pages ?? {}, pictures: stored.pictures ?? {} }
  return { source: origin, pages: {}, pictures: {} }
}

export function normalPath(input: string): string {
  const bare = input.split(/[?#]/)[0] ?? ''
  const withSlash = bare.startsWith('/') ? bare : `/${bare}`
  return withSlash.replace(/\/+$/, '') || '/'
}

/** The language a source address is in, by its first part, and the address without it. */
export function splitLanguage(address: string, languages: string[]): { lang: string; rest: string } {
  const [first] = languages
  const parts = normalPath(address).split('/').filter(Boolean)
  const lead = parts[0]?.toLowerCase()
  if (lead && languages.includes(lead)) return { lang: lead, rest: `/${parts.slice(1).join('/')}` }
  return { lang: first, rest: parts.length === 0 ? '/' : `/${parts.join('/')}` }
}

export function matchRule(rules: ImportRule[], rest: string): ImportRule | null {
  for (const rule of rules) {
    const match = rule.match.trim()
    if (match === '*') return rule
    const prefix = match.endsWith('/*') ? match.slice(0, -1) : match.endsWith('/') ? match : null
    if (prefix) {
      if (rest === prefix.slice(0, -1) || rest.startsWith(prefix)) return rule
    } else if (normalPath(match) === rest) return rule
  }
  return null
}

export function slugFor(rest: string): string {
  const joined = rest
    .split('/')
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (joined.length <= 60) return joined
  const cut = joined.slice(0, 60)
  const word = cut.lastIndexOf('-')
  return (word >= 30 ? cut.slice(0, word) : cut).replace(/-+$/, '')
}

/** The page's title and its text without that title. The first heading is the title; otherwise the browser tab's title without the site name. */
export function splitTitle(read: PageRead): { title: string; markdown: string } {
  const lines = read.markdown.split('\n')
  const index = lines.findIndex((line) => /^# \S/.test(line))
  if (index >= 0 && lines.slice(0, index).every((line) => !line.trim() || /^!\[/.test(line))) {
    const title = lines[index].replace(/^# /, '').trim()
    return { title, markdown: [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n') }
  }
  const tab = read.title.split(/\s+[|–—•·-]\s+/)[0]?.trim() ?? ''
  return { title: tab || read.title.trim(), markdown: read.markdown }
}

const AFTER_THE_TEXT = /^#{1,6}\s*(?:schreibe einen kommentar|hinterlasse einen kommentar|leave a (?:reply|comment)|kommentare?|comments?|ähnliche beiträge|related (?:posts|articles))\s*$/i

/** A page body holds no top heading of its own: the page title is the h1. What a blog adds under the text (the comment form, related posts) is cut. */
export function tidyMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  const end = lines.findIndex((line) => AFTER_THE_TEXT.test(line.trim()))
  return (end >= 0 ? lines.slice(0, end) : lines)
    .map((line) => (/^# \S/.test(line) ? `#${line}` : line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function firstParagraph(markdown: string): string {
  for (const block of markdown.split(/\n{2,}/)) {
    const text = block.trim()
    if (!text || /^(?:#|!\[|[-*>|]|\d+\.\s|---)/.test(text)) continue
    return text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
  }
  return ''
}

const PICTURE_MARKDOWN = /!\[([^\]]*)\]\(([^)\s]+)\)/g

export function pictureRefs(markdown: string): { alt: string; src: string }[] {
  return [...markdown.matchAll(PICTURE_MARKDOWN)].map((match) => ({ alt: match[1], src: match[2] }))
}

/** WordPress keeps a picture at several sizes (name-150x150.jpg). The page often shows a small one of a larger original. */
export function originalPicture(src: string): string | null {
  const original = src.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z0-9]{3,4}(?:\?.*)?$)/i, '')
  return original === src ? null : original
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function sameHost(a: string, b: string): boolean {
  return a.replace(/^www\./, '') === b.replace(/^www\./, '')
}

/** Links to pages of the source site that became pages here point at the new pages. */
export function rewriteLinks(markdown: string, origin: string, known: Map<string, string>): string {
  const base = new URL(origin)
  return markdown.replace(/\]\((https?:\/\/[^)\s]+)\)/g, (whole, href: string) => {
    try {
      const url = new URL(href)
      if (!sameHost(url.hostname, base.hostname)) return whole
      const target = known.get(normalPath(url.pathname))
      return target ? `](${target}${url.hash})` : whole
    } catch {
      return whole
    }
  })
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next]
        next += 1
        await run(item)
      }
    }),
  )
}

type Group = { rest: string; paths: Record<string, string> }
type Staged = { group: Group; rule: ImportRule; slug: string; reads: Record<string, PageRead>; failed: string[] }

function checkRules(root: string, rules: ImportRule[]): void {
  if (rules.length === 0) fail('Give at least one rule: which pages go into which layout.')
  const design = path.join(root, 'design')
  for (const rule of rules) {
    let slots: Record<string, { type: string }>
    try {
      slots = readLayout(design, rule.layout).slots
    } catch {
      fail(`Rule ${rule.match}: the layout ${rule.layout} does not exist. Look at the catalog or call read_layout first.`)
    }
    const need = (name: string | undefined, types: string[], what: string) => {
      if (!name) return
      const slot = slots[name]
      if (!slot) fail(`Rule ${rule.match}: ${rule.layout} has no slot ${name}. Its slots: ${Object.keys(slots).join(', ') || 'none'}.`)
      if (!types.includes(slot.type)) fail(`Rule ${rule.match}: the slot ${name} is ${slot.type}, and ${what} needs ${types.join(' or ')}.`)
    }
    need(rule.body ?? 'body', ['markdown'], 'the text')
    need(rule.summary, ['text'], 'the first paragraph')
    need(rule.lead, ['image'], 'the first picture')
  }
}

/** Take pages of a source site into the site by rule: read them, save their pictures, write them, and say what did not fit. */
export async function importPages(root: string, input: ImportInput, deps: ImportDeps): Promise<string> {
  checkRules(root, input.rules)
  const site = readSiteConfig(root)
  const languages = site.languages.map((language) => language.id)
  const defaultLang = languages[0]
  const listing = await deps.listPaths(input.source)
  if (listing.paths.length === 0) fail(`Found no pages on ${input.source}. Check the address, or read the pages one by one.`)
  const origin = listing.origin
  const record = readRecord(root, origin)
  const skip = new Set((input.skip ?? []).map((address) => splitLanguage(address, languages).rest))

  const groups = new Map<string, Group>()
  for (const address of listing.paths) {
    if (UTILITY.test(address)) continue
    const { lang, rest } = splitLanguage(address, languages)
    if (rest === '/') continue
    const group = groups.get(rest) ?? { rest, paths: {} }
    group.paths[lang] = normalPath(address)
    groups.set(rest, group)
  }

  const unmatched: string[] = []
  const missingDefault: string[] = []
  let covered = 0
  let already = 0
  const pending: { group: Group; rule: ImportRule }[] = []
  for (const group of [...groups.values()].sort((a, b) => a.rest.localeCompare(b.rest))) {
    if (!group.paths[defaultLang]) {
      missingDefault.push(Object.values(group.paths)[0])
      continue
    }
    if (skip.has(group.rest)) {
      covered += 1
      continue
    }
    const rule = matchRule(input.rules, group.rest)
    if (!rule) {
      unmatched.push(group.rest)
      continue
    }
    if (record.pages[group.paths[defaultLang]] && !input.refresh) {
      already += 1
      continue
    }
    pending.push({ group, rule })
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_BATCH, 1), MAX_BATCH)
  const recordedSlugs = new Set(Object.values(record.pages))
  let room = Math.max(0, MAX_PAGES - recordedSlugs.size)
  const batch: { group: Group; rule: ImportRule }[] = []
  for (const item of pending) {
    if (batch.length >= limit) break
    if (!record.pages[item.group.paths[defaultLang]]) {
      if (room <= 0) break
      room -= 1
    }
    batch.push(item)
  }
  const stoppedByLimit = pending.length > batch.length && room <= 0

  // Phase 1: choose the page names, then read the pages, a few at a time.
  const staged: Staged[] = []
  const skipped: string[] = []
  const taken = new Set(recordedSlugs)
  for (const item of batch) {
    const defaultPath = item.group.paths[defaultLang]
    const known = record.pages[defaultPath]
    const slug = known ?? slugFor(item.group.rest)
    if (!slug) {
      skipped.push(`${defaultPath}: no usable page name`)
      continue
    }
    if (!known && (readPage(root, slug) || taken.has(slug))) {
      skipped.push(`${defaultPath}: a page named ${slug} exists already (written in the first pass? pass its address in skip)`)
      continue
    }
    taken.add(slug)
    staged.push({ group: item.group, rule: item.rule, slug, reads: {}, failed: [] })
  }
  await pool(
    staged.flatMap((entry) => Object.entries(entry.group.paths).map(([lang, address]) => ({ entry, lang, address }))),
    3,
    async ({ entry, lang, address }) => {
      try {
        entry.reads[lang] = await deps.readPage(new URL(address, origin).href)
      } catch (error) {
        entry.failed.push(`${address}: ${error instanceof Error ? error.message : 'could not be read'}`)
      }
    },
  )

  // Phase 2: save the pictures the pages use.
  const pictureSkips = { read: 0, over: 0 }
  let newPictures = 0
  const pictureMap = new Map<string, string | null>()
  const saveOne = async (src: string, alt: string): Promise<string | null> => {
    const original = originalPicture(src)
    const known = record.pictures[src] ?? (original ? record.pictures[original] : undefined)
    if (known) return known
    if (Object.keys(record.pictures).length >= MAX_PICTURES) {
      pictureSkips.over += 1
      return null
    }
    for (const candidate of original ? [original, src] : [src]) {
      try {
        const fetched = await deps.fetchPicture(candidate)
        const saved = storePicture(root, {
          bytes: fetched.body,
          filename: stemFromFilename(safeDecode(new URL(fetched.url).pathname)),
          description: normalizeDescription(alt),
          tags: [],
        })
        record.pictures[src] = saved.address
        if (candidate !== src) record.pictures[candidate] = saved.address
        newPictures += 1
        return saved.address
      } catch {
        continue
      }
    }
    pictureSkips.read += 1
    return null
  }
  const readable = staged.filter((entry) => {
    if (entry.reads[defaultLang]) return true
    skipped.push(entry.failed.find((line) => line.startsWith(entry.group.paths[defaultLang])) ?? `${entry.group.paths[defaultLang]}: could not be read`)
    return false
  })
  for (const entry of readable) {
    for (const read of Object.values(entry.reads)) {
      for (const picture of pictureRefs(read.markdown)) {
        if (!pictureMap.has(picture.src)) pictureMap.set(picture.src, await saveOne(picture.src, picture.alt))
      }
    }
  }

  // Phase 3: every address that now has a page, so links can point at it, and then the pages themselves.
  const known = new Map<string, string>()
  const remember = (address: string, slug: string, lang: string) => known.set(normalPath(address), pageUrl(slug, lang, site))
  for (const [address, slug] of Object.entries(record.pages)) remember(address, slug, splitLanguage(address, languages).lang)
  for (const entry of readable) for (const [lang, address] of Object.entries(entry.group.paths)) if (entry.reads[lang]) remember(address, entry.slug, lang)

  const missingLang: string[] = []
  const done: Staged[] = []
  for (const entry of readable) {
    const page: PageFile = { slug: entry.slug, layout: entry.rule.layout, title: {}, slots: {} }
    const body: Record<string, string> = {}
    const summary: Record<string, string> = {}
    let lead: string | undefined
    for (const language of languages) {
      const read = entry.reads[language]
      if (!read) {
        if (entry.group.paths[language]) missingLang.push(entry.group.paths[language])
        continue
      }
      const split = splitTitle(read)
      page.title[language] = split.title
      let markdown = split.markdown.replace(PICTURE_MARKDOWN, (_whole, alt: string, src: string) => {
        const address = pictureMap.get(src) ?? record.pictures[src]
        return address ? `![${alt}](${address})` : ''
      })
      if (entry.rule.lead && !lead) lead = pictureRefs(markdown)[0]?.src
      if (lead) {
        const escaped = lead.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        markdown = markdown.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)\\n*`), '')
      }
      markdown = tidyMarkdown(rewriteLinks(markdown, origin, known))
      body[language] = markdown
      if (entry.rule.summary) summary[language] = firstParagraph(markdown)
      if (entry.rule.dated && read.date && !page.date && language === defaultLang) page.date = read.date
    }
    page.slots[entry.rule.body ?? 'body'] = body
    if (entry.rule.summary) page.slots[entry.rule.summary] = summary
    if (entry.rule.lead && lead) page.slots[entry.rule.lead] = lead
    const problems = checkPage(root, page)
    if (problems.length > 0) {
      skipped.push(`${entry.group.paths[defaultLang]}: ${problems.slice(0, 2).join('; ')}`)
      continue
    }
    writePage(root, page)
    for (const [lang, address] of Object.entries(entry.group.paths)) if (entry.reads[lang]) record.pages[address] = entry.slug
    done.push(entry)
  }

  // Phase 4: a page imported earlier may link to one that exists now.
  const relinked = relinkEarlier(root, record, origin, known, new Set(done.map((entry) => entry.slug)))
  writeYaml(recordPath(root), record)

  const remaining = pending.length - batch.length
  const lines = [
    done.length === 0
      ? 'No page was imported in this call.'
      : `Imported ${done.length} page${done.length === 1 ? '' : 's'} and ${newPictures} picture${newPictures === 1 ? '' : 's'} from ${origin}.`,
    ...done.slice(0, 20).map((entry) => `- ${entry.group.paths[defaultLang]} → ${entry.slug} (${languages.filter((language) => entry.reads[language]).join(', ')})`),
  ]
  if (done.length > 20) lines.push(`… and ${done.length - 20} more.`)
  if (stoppedByLimit) lines.push('', `Stopped at the limit of ${MAX_PAGES} pages for one source site. ${remaining} matching pages were left out.`)
  else if (remaining > 0) lines.push('', `${remaining} more pages match your rules. Call import_pages again with the same rules to continue.`)
  else if (done.length > 0 || already > 0) lines.push('', 'Every page that matches your rules is imported.')
  const report: string[] = []
  if (already > 0) report.push(`${already} pages were imported before and are left as they are (refresh: true reads them again and overwrites them).`)
  if (covered > 0) report.push(`${covered} pages were left out because the first pass already has them.`)
  if (unmatched.length > 0) report.push(`${unmatched.length} pages match no rule, for example ${unmatched.slice(0, 4).join(', ')}.`)
  if (missingDefault.length > 0) report.push(`${missingDefault.length} pages exist only in another language and have no ${defaultLang} page, for example ${missingDefault.slice(0, 3).join(', ')}.`)
  if (missingLang.length > 0) report.push(`${missingLang.length} translated versions could not be read, so those pages miss that language, for example ${missingLang.slice(0, 3).join(', ')}.`)
  for (const line of skipped.slice(0, 12)) report.push(line)
  if (skipped.length > 12) report.push(`… and ${skipped.length - 12} more pages that failed.`)
  if (pictureSkips.read > 0) report.push(`${pictureSkips.read} pictures could not be saved (too large, not a supported format, or not reachable) and are not on the pages.`)
  if (pictureSkips.over > 0) report.push(`${pictureSkips.over} pictures were left out: ${MAX_PICTURES} pictures is the limit for one source site.`)
  if (relinked > 0) report.push(`${relinked} earlier pages now link to the new pages.`)
  if (!listing.sitemap) report.push('The site has no sitemap, so the list of pages came from the links on its front page and may be incomplete.')
  if (report.length > 0) lines.push('', 'Not imported:', ...report.map((line) => `- ${line}`))
  if (done.length > 0) lines.push('', 'The new pages are not in the menu yet. Pictures are stored as the originals; fit_picture makes smaller copies.')
  return lines.join('\n')
}

function mapStrings(value: unknown, change: (text: string) => string): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const next = change(value)
    return { value: next, changed: next !== value }
  }
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((item) => {
      const result = mapStrings(item, change)
      changed = changed || result.changed
      return result.value
    })
    return { value: out, changed }
  }
  if (value && typeof value === 'object') {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const result = mapStrings(item, change)
      changed = changed || result.changed
      out[key] = result.value
    }
    return { value: out, changed }
  }
  return { value, changed: false }
}

function relinkEarlier(root: string, record: SourceRecord, origin: string, known: Map<string, string>, justWritten: Set<string>): number {
  let count = 0
  for (const slug of new Set(Object.values(record.pages))) {
    if (justWritten.has(slug)) continue
    const page = readPage(root, slug)
    if (!page) continue
    const result = mapStrings(page.slots, (text) => rewriteLinks(text, origin, known))
    if (!result.changed) continue
    writePage(root, { ...page, slots: result.value as Record<string, unknown> })
    count += 1
  }
  return count
}
