import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify } from 'yaml'
import { assertInside, assertSlug, readYaml, type EventDoc } from './content'
import { layoutExists, pageLayouts, readLayout } from './layouts'
import { readSiteConfig, requiredLanguages } from './model'
import { validateSlots, withoutLanguages } from './slots'

/** One page. Titles and translated slot text hold one entry per language. */
export type PageFile = {
  slug: string
  layout: string
  date?: string
  title: Record<string, string>
  slots: Record<string, unknown>
}

export function pageFilePath(root: string, slug: string): string {
  assertSlug(slug)
  const file = path.join(root, 'content', 'pages', `${slug}.yml`)
  assertInside(root, file)
  return file
}

export function listPageSlugs(root: string): string[] {
  const base = path.join(root, 'content', 'pages')
  const slugs: string[] = []
  const walk = (dir: string, prefix: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      else if (entry.isFile() && entry.name.endsWith('.yml')) slugs.push(`${prefix}${entry.name.slice(0, -4)}`)
    }
  }
  walk(base, '')
  return slugs.sort()
}

export function readPage(root: string, slug: string): PageFile | null {
  const file = pageFilePath(root, slug)
  if (!fs.existsSync(file)) return null
  const raw = (parse(fs.readFileSync(file, 'utf8')) ?? {}) as Record<string, unknown>
  const title = raw.title && typeof raw.title === 'object' && !Array.isArray(raw.title) ? (raw.title as Record<string, unknown>) : {}
  return {
    slug,
    layout: typeof raw.layout === 'string' ? raw.layout : 'article',
    date: raw.date ? String(raw.date).slice(0, 10) : undefined,
    title: Object.fromEntries(Object.entries(title).filter(([, text]) => typeof text === 'string')) as Record<string, string>,
    slots: raw.slots && typeof raw.slots === 'object' && !Array.isArray(raw.slots) ? (raw.slots as Record<string, unknown>) : {},
  }
}

export function writePage(root: string, page: PageFile): void {
  const file = pageFilePath(root, page.slug)
  const body: Record<string, unknown> = { layout: page.layout }
  if (page.date) body.date = page.date
  body.title = page.title
  body.slots = page.slots
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, stringify(body, { lineWidth: 0 }))
}

export function deletePage(root: string, slug: string): boolean {
  const file = pageFilePath(root, slug)
  if (!fs.existsSync(file)) return false
  fs.rmSync(file)
  let dir = path.dirname(file)
  const base = path.join(root, 'content', 'pages')
  while (dir !== base && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir)
    dir = path.dirname(dir)
  }
  return true
}

export function pageHasLanguage(page: PageFile, lang: string): boolean {
  return Boolean(page.title[lang]?.trim())
}

export function pagesByLayout(root: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const slug of listPageSlugs(root)) {
    const page = readPage(root, slug)
    if (!page) continue
    map.set(page.layout, [...(map.get(page.layout) ?? []), slug])
  }
  return map
}

/** Why a page is not complete: a title or a required slot missing, a slot the layout does not have. */
export function checkPage(root: string, page: PageFile): string[] {
  const designDir = path.join(root, 'design')
  const site = readSiteConfig(root)
  const errors: string[] = []
  for (const id of Object.keys(page.title)) {
    if (!site.languages.some((language) => language.id === id)) errors.push(`title has unknown language ${id}`)
  }
  for (const language of site.languages) {
    if (!language.optional && !page.title[language.id]?.trim()) errors.push(`title.${language.id} is required`)
  }
  if (!layoutExists(designDir, page.layout)) {
    errors.push(`unknown layout ${page.layout}. Choose one of: ${pageLayouts(designDir).join(', ')}`)
    return errors
  }
  const def = readLayout(designDir, page.layout)
  errors.push(...validateSlots(def.slots, page.slots, site.languages).errors)
  return errors
}

/** Everything that blocks publishing: pages and events that miss a language that is not optional. */
export function bilingualGaps(root: string): string[] {
  const gaps: string[] = []
  const required = requiredLanguages(root)
  for (const slug of listPageSlugs(root)) {
    const page = readPage(root, slug)
    if (!page) continue
    for (const error of checkPage(root, page)) gaps.push(`page ${slug}: ${error}`)
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

/**
 * Take the texts of languages the site does not have out of its pages, for a site whose languages were just
 * narrowed (the starter has a German and an English text on every page, and a site in German only must not keep
 * the English one: it would block publishing). Returns the pages that changed.
 */
export function dropOtherLanguages(root: string): string[] {
  const designDir = path.join(root, 'design')
  const languages = readSiteConfig(root).languages
  const known = new Set(languages.map((language) => language.id))
  const changed: string[] = []
  for (const slug of listPageSlugs(root)) {
    const page = readPage(root, slug)
    if (!page) continue
    const title = Object.fromEntries(Object.entries(page.title).filter(([id]) => known.has(id)))
    const slots = layoutExists(designDir, page.layout) ? (withoutLanguages(readLayout(designDir, page.layout).slots, page.slots, languages) as Record<string, unknown>) : page.slots
    if (JSON.stringify(title) === JSON.stringify(page.title) && JSON.stringify(slots) === JSON.stringify(page.slots)) continue
    writePage(root, { ...page, title, slots })
    changed.push(slug)
  }
  return changed
}
