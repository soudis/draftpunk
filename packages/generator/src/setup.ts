import fs from 'node:fs'
import path from 'node:path'
import { writeYaml, type EventDoc, type PlaceDoc } from './content'
import { pageLayoutsOrThrow, replaceLayout } from './generate'
import { GENERATED_LAYOUTS, labelReferences, layoutExists, listLayoutNames, removeLayoutFolder, writeLayout } from './layouts'
import { checkPage, listPageSlugs, readPage, writePage } from './pages'
import { parse, stringify } from 'yaml'
import { parseTokens } from './tokens'
import { labelNames, parseLabels, readEventFields, readSiteConfig, readYamlFile, writeYamlFile, type SiteLanguage } from './model'

export type SetupProposal = {
  site?: {
    name?: string
    id?: string
    timezone?: string
    url?: string
    languages?: { id: string; label?: string; optional?: boolean }[]
  }
  layouts?: { name: string; purpose: string; slots?: unknown; template: string; style?: string }[]
  dropLayouts?: string[]
  fields?: unknown[]
  look?: { styles?: string; shell?: string; brief?: string }
  nav?: unknown
  labels?: Record<string, Record<string, string>>
  tokens?: unknown
  pages?: {
    slug: string
    layout: string
    title: Record<string, string>
    date?: string
    slots?: Record<string, unknown>
  }[]
  events?: EventDoc[]
  places?: PlaceDoc[]
}

export function recordProposal(root: string, proposal: SetupProposal): void {
  proposal = normalizeProposal(proposal)
  const current = readYamlFile<SetupProposal>(path.join(root, 'design', 'proposal.yml'), {})
  writeYamlFile(path.join(root, 'design', 'proposal.yml'), { ...current, ...proposal })
}

export function readProposal(root: string): SetupProposal {
  return readYamlFile<SetupProposal>(path.join(root, 'design', 'proposal.yml'), {})
}

export function applyProposal(root: string, input: SetupProposal, finish = false): string {
  const proposal = normalizeProposal(input)
  if (proposal.site?.timezone?.trim()) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: proposal.site.timezone.trim() }).format(new Date())
    } catch {
      throw new Error(`Unknown timezone ${proposal.site.timezone}`)
    }
  }
  const notes: string[] = []
  if (proposal.site) {
    const current = readSiteConfig(root)
    const languages = proposal.site.languages?.map(normalizeLanguage).filter((lang): lang is SiteLanguage => Boolean(lang))
    writeYamlFile(path.join(root, 'design', 'site.yml'), {
      name: proposal.site.name?.trim() || current.name,
      id: proposal.site.id?.trim() || current.id,
      timezone: proposal.site.timezone?.trim() || current.timezone,
      url: proposal.site.url?.trim() || current.url,
      languages: languages && languages.length > 0 ? languages : current.languages,
    })
    notes.push('site')
  }
  if (proposal.fields) {
    writeYamlFile(path.join(root, 'design', 'fields.yml'), proposal.fields)
    const categories = (Array.isArray(proposal.fields) ? proposal.fields : []).find(
      (field) => field && typeof field === 'object' && (field as { id?: string }).id === 'categories',
    ) as { options?: { id?: string; label?: Record<string, string>; de?: string; en?: string }[] } | undefined
    if (categories?.options) {
      writeYaml(
        path.join(root, 'design', 'categories.yml'),
        categories.options.map((option) => ({
          id: option.id,
          de: option.label?.de ?? option.de ?? option.id,
          en: option.label?.en ?? option.en ?? option.label?.de ?? option.id,
        })),
      )
    }
    notes.push('fields')
  }
  for (const layout of proposal.layouts ?? []) {
    writeLayout(path.join(root, 'design'), {
      name: layout.name,
      purpose: layout.purpose,
      slots: layout.slots ?? {},
      template: layout.template,
      style: layout.style,
    })
    notes.push(`layout ${layout.name}`)
  }
  for (const name of proposal.dropLayouts ?? []) {
    if ((GENERATED_LAYOUTS as readonly string[]).includes(name)) {
      throw new Error(`Layout ${name} is part of the calendar and archive.`)
    }
    const used = pagesUsing(root, name)
    if (used.length > 0) replaceLayout(root, name, fallbackLayout(root, name))
    else removeLayoutFolder(path.join(root, 'design'), name)
    notes.push(`dropped ${name}`)
  }
  if (proposal.labels) {
    const current = readYamlFile<Record<string, unknown>>(path.join(root, 'design', 'labels.yml'), {})
    writeYamlFile(path.join(root, 'design', 'labels.yml'), { ...current, ...proposal.labels })
    notes.push('labels')
  }
  if (proposal.tokens !== undefined) {
    const text = typeof proposal.tokens === 'string' ? proposal.tokens : stringify(proposal.tokens)
    parseTokens(text)
    fs.writeFileSync(path.join(root, 'design', 'tokens.yml'), text)
    notes.push('tokens')
  }
  if (proposal.look?.styles) {
    fs.writeFileSync(path.join(root, 'design', 'styles.css'), proposal.look.styles)
    notes.push('stylesheet')
  }
  if (proposal.look?.shell) {
    fs.writeFileSync(path.join(root, 'design', 'shell.njk'), proposal.look.shell)
    notes.push('shell')
  }
  if (proposal.look?.brief) {
    fs.writeFileSync(path.join(root, 'design', 'brief.md'), proposal.look.brief)
    notes.push('brief')
  }
  if (proposal.nav) {
    writeYaml(path.join(root, 'design', 'nav.yml'), proposal.nav)
    notes.push('nav')
  }
  for (const place of proposal.places ?? []) {
    writeYaml(path.join(root, 'content', 'places', `${place.slug}.yml`), place)
    notes.push(`place ${place.slug}`)
  }
  const knownCategories = new Set(
    readEventFields(root).find((field) => field.id === 'categories')?.options.map((option) => option.id) ?? [],
  )
  for (const event of proposal.events ?? []) {
    for (const category of event.categories ?? []) {
      if (knownCategories.size > 0 && !knownCategories.has(category)) throw new Error(`Unknown category ${category}`)
    }
    writeYaml(path.join(root, 'content', 'events', `${event.slug}.yml`), event)
    notes.push(`event ${event.slug}`)
  }
  for (const page of proposal.pages ?? []) {
    pageLayoutsOrThrow(root, page.layout)
    const next = { slug: page.slug, layout: page.layout, date: page.date, title: page.title ?? {}, slots: page.slots ?? {} }
    const errors = checkPage(root, next)
    if (errors.length > 0) throw new Error(`Page ${page.slug}: ${errors.join('; ')}`)
    writePage(root, next)
    notes.push(`page ${page.slug}`)
  }
  const templates = [...(proposal.layouts ?? []).map((layout) => layout.template), proposal.look?.shell ?? '']
  const defined = new Set(labelNames(root))
  const missing = [...new Set(templates.flatMap((template) => labelReferences(template)))].filter((name) => !defined.has(name))
  if (missing.length > 0) notes.push(`WARNING labels used by templates but not in design/labels.yml, so they show nothing: ${missing.join(', ')}`)
  if (finish) {
    writeYamlFile(path.join(root, 'design', 'setup.yml'), { accepted: true })
    notes.push('setup accepted')
  }
  return notes.join(', ') || 'nothing changed'
}

function normalizeLanguage(lang: { id: string; label?: string; optional?: boolean }): SiteLanguage | null {
  const id = lang.id.trim().toLowerCase()
  if (!/^[a-z]{2}(?:-[a-z0-9]+)*$/.test(id)) return null
  return { id, label: lang.label?.trim() || id, optional: lang.optional === true }
}

function pagesUsing(root: string, layout: string): string[] {
  return listPageSlugs(root).filter((slug) => readPage(root, slug)?.layout === layout)
}

function fallbackLayout(root: string, dropped: string): string {
  const designDir = path.join(root, 'design')
  if (layoutExists(designDir, 'article') && dropped !== 'article') return 'article'
  const other = listLayoutNames(designDir).find((name) => name !== dropped && !(GENERATED_LAYOUTS as readonly string[]).includes(name))
  if (!other) throw new Error(`No other layout to move the pages of ${dropped} to`)
  return other
}

const OBJECT_KEYS = ['site', 'tokens', 'labels', 'look'] as const
const LIST_KEYS = ['layouts', 'dropLayouts', 'pages', 'events', 'places'] as const

function fromText(value: unknown, name: string): unknown {
  if (typeof value !== 'string') return value
  try {
    return parse(value)
  } catch (error) {
    throw new Error(`${name} is not valid YAML: ${error instanceof Error ? error.message.split('\n')[0] : 'unreadable'}`)
  }
}

/**
 * A model sometimes sends a part of the proposal as the text of a file instead of as data. Read that text,
 * and say plainly what is wrong with anything that cannot be used, instead of writing it into the site.
 */
export function normalizeProposal(proposal: SetupProposal): SetupProposal {
  const out: Record<string, unknown> = { ...proposal }
  for (const key of OBJECT_KEYS) {
    if (out[key] === undefined) continue
    if (key === 'tokens' && typeof out[key] === 'string') {
      parseTokens(out[key] as string)
      continue
    }
    out[key] = fromText(out[key], key)
    if (out[key] === null || typeof out[key] !== 'object' || Array.isArray(out[key])) throw new Error(`${key} must be an object`)
  }
  for (const key of LIST_KEYS) {
    if (out[key] === undefined) continue
    out[key] = fromText(out[key], key)
    if (!Array.isArray(out[key])) throw new Error(`${key} must be a list`)
  }
  for (const key of ['fields', 'nav'] as const) {
    if (out[key] === undefined) continue
    out[key] = fromText(out[key], key)
    if (out[key] === null || typeof out[key] !== 'object') throw new Error(`${key} must be a list or an object, not text`)
  }
  if (out.labels !== undefined) out.labels = parseLabels(out.labels)
  return out as SetupProposal
}
