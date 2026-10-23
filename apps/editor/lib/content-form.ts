import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify } from 'yaml'
import {
  checkPage,
  designFilePath,
  layoutExists,
  listPageSlugs,
  readEventFields,
  readLayout,
  readPage,
  readSiteConfig,
  validateSlots,
  writePage,
  type SlotDef,
  type SlotSchema,
} from '@schlor/generator'
import { pageEntries } from './page-list'

export type Label = { de: string; en: string }

export type FieldType = 'text' | 'markdown' | 'image' | 'link' | 'date' | 'datetime' | 'list' | 'group' | 'select' | 'multiselect' | 'toggle'

/** One input of a content form. A form is a list of these, and the browser draws it without knowing the file's shape. */
export type FormField = {
  key: string
  label: Label
  type: FieldType
  /** One text per language of the site. */
  translate?: boolean
  required?: boolean
  /** The item of a list. */
  of?: FormField
  /** The inputs of a group. */
  fields?: FormField[]
  /** A group drawn without a frame or a heading. */
  flat?: boolean
  options?: { id: string; label: string }[]
  /** A line of help under the label. */
  hint?: Label
}

export type ContentKind = 'page' | 'event' | 'place' | 'home' | 'redirects'

export type ContentEntry = { file: string; kind: ContentKind; title: string; sub: string; sort: string }

export type ContentForm = {
  file: string
  kind: ContentKind
  title: string
  /** The layout of a page. A hand edit never changes it. */
  layout?: string
  /** A hash of the file as it was read. Save sends it back, so a file that changed in between is not overwritten. */
  revision: string
  languages: { id: string; label: string; optional: boolean }[]
  fields: FormField[]
  values: Record<string, unknown>
}

const PAGE_FILE = /^content\/pages\/([a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)\.yml$/
const EVENT_FILE = /^content\/events\/([a-z0-9]+(?:-[a-z0-9]+)*)\.yml$/
const PLACE_FILE = /^content\/places\/([a-z0-9]+(?:-[a-z0-9]+)*)\.yml$/

export function contentKind(file: string): ContentKind | null {
  if (PAGE_FILE.test(file)) return 'page'
  if (EVENT_FILE.test(file)) return 'event'
  if (PLACE_FILE.test(file)) return 'place'
  if (file === 'content/home.yml') return 'home'
  if (file === 'content/redirects.yml') return 'redirects'
  return null
}

/** The path of a content file the browser may open. Anything else is refused, so a request cannot reach other files. */
export function contentPath(root: string, file: unknown): { file: string; kind: ContentKind; full: string } {
  const normalized = typeof file === 'string' ? file.replaceAll('\\', '/') : ''
  const kind = contentKind(normalized)
  if (!kind) throw new Error('That is not a content file.')
  return { file: normalized, kind, full: path.join(root, normalized) }
}

function revisionOf(bytes: Buffer | null): string {
  return bytes ? createHash('sha1').update(bytes).digest('hex') : 'none'
}

function readBytes(full: string): Buffer | null {
  return fs.existsSync(full) ? fs.readFileSync(full) : null
}

function readRaw(full: string): Record<string, unknown> {
  const parsed = fs.existsSync(full) ? parse(fs.readFileSync(full, 'utf8')) : {}
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
}

function textMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, text]) => typeof text === 'string')) as Record<string, string>
}

function both(de: string, en: string): Label {
  return { de, en }
}

function humanize(name: string): Label {
  const text = name.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
  return { de: text, en: text }
}

/** Every content file with a title for the browser: pages, events, places, and the two list files. */
export function contentEntries(root: string): ContentEntry[] {
  const languages = readSiteConfig(root).languages
  const first = (map: Record<string, string>, fallback: string) => languages.map((language) => map[language.id]?.trim()).find(Boolean) || Object.values(map).find((text) => text.trim()) || fallback
  const entries: ContentEntry[] = []
  for (const entry of pageEntries(root)) {
    const page = readPage(root, entry.slug)
    entries.push({
      file: `content/pages/${entry.slug}.yml`,
      kind: 'page',
      title: entry.title,
      sub: [page?.layout, page?.date].filter(Boolean).join(' · '),
      sort: entry.slug === 'home' ? '' : entry.title.toLowerCase(),
    })
  }
  const dir = (name: string) => path.join(root, 'content', name)
  if (fs.existsSync(dir('events'))) {
    for (const name of fs.readdirSync(dir('events')).filter((item) => item.endsWith('.yml')).sort()) {
      const raw = readRaw(path.join(dir('events'), name))
      const dates = Array.isArray(raw.dates) ? (raw.dates as { start?: unknown }[]) : []
      const start = typeof dates[0]?.start === 'string' ? dates[0].start.slice(0, 10) : ''
      const slug = name.slice(0, -4)
      entries.push({ file: `content/events/${name}`, kind: 'event', title: first(textMap(raw.title), slug), sub: start, sort: start })
    }
  }
  if (fs.existsSync(dir('places'))) {
    for (const name of fs.readdirSync(dir('places')).filter((item) => item.endsWith('.yml')).sort()) {
      const raw = readRaw(path.join(dir('places'), name))
      const slug = name.slice(0, -4)
      const title = first(textMap(raw.name), slug)
      entries.push({ file: `content/places/${name}`, kind: 'place', title, sub: raw.onPremises === true ? 'on the premises' : '', sort: title.toLowerCase() })
    }
  }
  if (fs.existsSync(path.join(root, 'content', 'home.yml'))) entries.push({ file: 'content/home.yml', kind: 'home', title: 'Home news', sub: '', sort: '' })
  if (fs.existsSync(path.join(root, 'content', 'redirects.yml'))) entries.push({ file: 'content/redirects.yml', kind: 'redirects', title: 'Redirects', sub: '', sort: '' })
  return entries
}

/** The text files of the design that can be read but not edited by hand. */
export function designTextEntries(root: string): { file: string; title: string }[] {
  const names = ['brief.md', 'rules.md']
  const refs = path.join(root, 'design', 'references')
  const found = names.filter((name) => fs.existsSync(path.join(root, 'design', name)))
  if (fs.existsSync(refs)) {
    for (const name of fs.readdirSync(refs).filter((item) => item.endsWith('.md')).sort()) found.push(`references/${name}`)
  }
  return found.map((name) => ({ file: `design/${name}`, title: name }))
}

export function readDesignText(root: string, file: unknown): string {
  const name = typeof file === 'string' && file.startsWith('design/') ? file.slice('design/'.length) : ''
  if (!name.endsWith('.md')) throw new Error('That is not a design text.')
  const full = designFilePath(root, name)
  if (!fs.existsSync(full)) throw new Error('That file does not exist.')
  return fs.readFileSync(full, 'utf8')
}

function slotField(name: string, def: SlotDef): FormField {
  const field: FormField = { key: name, label: humanize(name), type: def.type === 'list' || def.type === 'group' ? def.type : (def.type as FieldType), required: def.required }
  if (def.type === 'text' || def.type === 'markdown') field.translate = def.translate
  if (def.type === 'list' && def.of) field.of = slotField('', def.of)
  if (def.type === 'group') field.fields = slotFields(def.fields ?? {})
  return field
}

function slotFields(schema: SlotSchema): FormField[] {
  return Object.entries(schema).map(([name, def]) => slotField(name, def))
}

function placeOptions(root: string): { id: string; label: string }[] {
  const dir = path.join(root, 'content', 'places')
  if (!fs.existsSync(dir)) return []
  const languages = readSiteConfig(root).languages
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yml'))
    .sort()
    .map((name) => {
      const names = textMap(readRaw(path.join(dir, name)).name)
      const id = name.slice(0, -4)
      return { id, label: languages.map((language) => names[language.id]?.trim()).find(Boolean) || id }
    })
}

function label(map: Record<string, string>, languages: { id: string }[], fallback: string): string {
  return languages.map((language) => map[language.id]?.trim()).find(Boolean) || fallback
}

export function readContentForm(root: string, file: unknown): ContentForm {
  const { file: name, kind, full } = contentPath(root, file)
  const bytes = readBytes(full)
  if (!bytes) throw new Error('That file does not exist.')
  const site = readSiteConfig(root)
  const base = { file: name, kind, revision: revisionOf(bytes), languages: site.languages }
  if (kind === 'page') {
    const slug = PAGE_FILE.exec(name)?.[1] ?? ''
    const page = readPage(root, slug)
    if (!page) throw new Error('That page could not be read.')
    const designDir = path.join(root, 'design')
    const schema = layoutExists(designDir, page.layout) ? readLayout(designDir, page.layout).slots : {}
    return {
      ...base,
      title: label(page.title, site.languages, slug),
      layout: page.layout,
      fields: [
        { key: 'title', label: both('Titel', 'Title'), type: 'text', translate: true, required: true },
        { key: 'date', label: both('Datum', 'Date'), type: 'date', hint: both('Nur für datierte Seiten, etwa Neuigkeiten.', 'Only for dated pages, such as news items.') },
        { key: 'slots', label: both('Inhalt', 'Content'), type: 'group', flat: true, fields: slotFields(schema ?? {}) },
      ],
      values: { title: page.title, date: page.date ?? '', slots: page.slots },
    }
  }
  const raw = readRaw(full)
  if (kind === 'event') {
    const known = readEventFields(root)
    const extra = known.filter((field) => field.id !== 'categories')
    const categories = known.find((field) => field.id === 'categories')
    const optionsOf = (field: { options: { id: string; label: Record<string, string> }[] }) =>
      field.options.map((option) => ({ id: option.id, label: option.label.de || option.label.en || option.id }))
    const fields: FormField[] = [
      { key: 'title', label: both('Titel', 'Title'), type: 'text', translate: true, required: true },
      { key: 'body', label: both('Beschreibung', 'Description'), type: 'markdown', translate: true, required: true },
      { key: 'place', label: both('Ort', 'Place'), type: 'select', options: placeOptions(root) },
      ...(categories ? [{ key: 'categories', label: both('Kategorien', 'Categories'), type: 'multiselect' as const, options: optionsOf(categories) }] : []),
      ...extra.map((field): FormField => ({
        key: `field:${field.id}`,
        label: { de: field.label.de || field.id, en: field.label.en || field.id },
        type: field.multiple ? 'multiselect' : 'select',
        options: optionsOf(field),
      })),
      {
        key: 'dates',
        label: both('Termine', 'Dates'),
        type: 'list',
        of: {
          key: '',
          label: both('Termin', 'Date'),
          type: 'group',
          fields: [
            { key: 'start', label: both('Beginn', 'Start'), type: 'datetime', required: true },
            { key: 'end', label: both('Ende', 'End'), type: 'datetime' },
          ],
        },
      },
    ]
    const stored = textMap(raw.fields as unknown)
    const values: Record<string, unknown> = {
      title: textMap(raw.title),
      body: textMap(raw.body),
      place: typeof raw.place === 'string' ? raw.place : '',
      categories: Array.isArray(raw.categories) ? raw.categories.map(String) : [],
      dates: (Array.isArray(raw.dates) ? (raw.dates as { start?: unknown; end?: unknown }[]) : []).map((date) => ({
        start: typeof date.start === 'string' ? toWall(date.start, site.timezone) : '',
        end: typeof date.end === 'string' ? toWall(date.end, site.timezone) : '',
      })),
    }
    for (const field of extra) {
      const value = stored[field.id] ?? ''
      values[`field:${field.id}`] = field.multiple ? value.split(',').map((item) => item.trim()).filter(Boolean) : value
    }
    return { ...base, title: label(textMap(raw.title), site.languages, name), fields, values }
  }
  if (kind === 'place') {
    return {
      ...base,
      title: label(textMap(raw.name), site.languages, name),
      fields: [
        { key: 'name', label: both('Name', 'Name'), type: 'text', translate: true, required: true },
        { key: 'address', label: both('Adresse', 'Address'), type: 'text' },
        { key: 'onPremises', label: both('Auf dem Gelände des Projekts', 'On the premises of the project'), type: 'toggle' },
      ],
      values: { name: textMap(raw.name), address: typeof raw.address === 'string' ? raw.address : '', onPremises: raw.onPremises === true },
    }
  }
  if (kind === 'home') {
    return {
      ...base,
      title: 'Home news',
      fields: [
        {
          key: 'news',
          label: both('Neuigkeiten auf der Startseite', 'News on the home page'),
          type: 'list',
          hint: both('In dieser Reihenfolge, die erste zuerst.', 'In this order, the first one first.'),
          of: { key: '', label: both('Seite', 'Page'), type: 'select', options: pageEntries(root).map((entry) => ({ id: entry.slug, label: entry.title })) },
        },
      ],
      values: { news: Array.isArray(raw.news) ? raw.news.map(String) : [] },
    }
  }
  const list = fs.existsSync(full) ? parse(fs.readFileSync(full, 'utf8')) : []
  return {
    ...base,
    title: 'Redirects',
    fields: [
      {
        key: 'redirects',
        label: both('Weiterleitungen', 'Redirects'),
        type: 'list',
        of: {
          key: '',
          label: both('Weiterleitung', 'Redirect'),
          type: 'group',
          fields: [
            { key: 'from', label: both('Von (Adresse auf der Website)', 'From (address on the site)'), type: 'text', required: true },
            { key: 'to', label: both('Nach', 'To'), type: 'text', required: true },
          ],
        },
      },
    ],
    values: { redirects: Array.isArray(list) ? list.map((item) => ({ from: String((item as { from?: unknown }).from ?? ''), to: String((item as { to?: unknown }).to ?? '') })) : [] },
  }
}

const ZONE = /(Z|[+-]\d{2}:?\d{2})$/i

/** The wall clock of a stored date in the site's time zone, as a datetime-local input wants it. */
export function toWall(stored: string, timeZone: string): string {
  const text = stored.trim()
  if (!ZONE.test(text)) {
    const [date, time = '00:00'] = text.split('T')
    return `${date}T${time.slice(0, 5)}`
  }
  const when = new Date(text)
  if (Number.isNaN(when.getTime())) return ''
  const parts = zoned(when.getTime(), timeZone)
  return `${parts.y}-${parts.m}-${parts.d}T${parts.h}:${parts.mi}`
}

function zoned(ms: number, timeZone: string): Record<'y' | 'm' | 'd' | 'h' | 'mi', string> {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  )
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour, mi: parts.minute }
}

/** The moment a wall clock time in the site's time zone is, as the UTC string events keep. */
export function fromWall(wall: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall)
  if (!match) throw new Error(`${wall} is not a date and time`)
  const [y, m, d, h, mi] = match.slice(1).map(Number)
  const local = Date.UTC(y, m - 1, d, h, mi)
  let guess = local
  for (let step = 0; step < 2; step += 1) {
    const shown = zoned(guess, timeZone)
    guess += local - Date.UTC(Number(shown.y), Number(shown.m) - 1, Number(shown.d), Number(shown.h), Number(shown.mi))
  }
  return new Date(guess).toISOString()
}

export type SaveResult = { ok: true; file: string; revision: string; previous: Buffer } | { ok: false; error: string; stale?: boolean }

function textValues(value: unknown, where: string, known: { id: string }[]): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must have one text per language`)
  const out: Record<string, string> = {}
  for (const [id, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text !== 'string') throw new Error(`${where}.${id} must be text`)
    if (!known.some((language) => language.id === id)) throw new Error(`${where} has the unknown language ${id}`)
    out[id] = text
  }
  return out
}

function stringList(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${where} must be a list`)
  return value as string[]
}

/** Check a form's values and write the file. It does not commit; the caller regenerates the site and commits, and puts `previous` back if that fails. */
export function writeContentForm(root: string, file: unknown, values: unknown, baseRevision: unknown): SaveResult {
  let target: ReturnType<typeof contentPath>
  try {
    target = contentPath(root, file)
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
  const previous = readBytes(target.full)
  if (!previous) return { ok: false, error: 'That file does not exist.' }
  if (typeof baseRevision !== 'string' || baseRevision !== revisionOf(previous)) {
    return { ok: false, error: 'This file changed since you opened it.', stale: true }
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, error: 'There is nothing to save.' }
  const input = values as Record<string, unknown>
  const site = readSiteConfig(root)
  try {
    if (target.kind === 'page') writePageForm(root, target.file, input, site.languages)
    else if (target.kind === 'event') writeEventForm(root, target.full, input, site)
    else if (target.kind === 'place') writePlaceForm(target.full, input, site.languages)
    else if (target.kind === 'home') writeHomeForm(root, target.full, input)
    else writeRedirectsForm(target.full, input)
  } catch (error) {
    fs.writeFileSync(target.full, previous)
    return { ok: false, error: error instanceof Error ? error.message : 'That could not be saved.' }
  }
  return { ok: true, file: target.file, revision: revisionOf(readBytes(target.full)), previous }
}

/** Put a file back to the bytes it had before a save that did not work out. */
export function putBack(root: string, file: string, previous: Buffer): void {
  fs.writeFileSync(contentPath(root, file).full, previous)
}

// What a save leaves to Publish: a text missing in a language that is not optional, in a title or a required slot.
const MISSING = / is required/

function writePageForm(root: string, file: string, input: Record<string, unknown>, languages: { id: string; label: string; optional: boolean }[]): void {
  const slug = PAGE_FILE.exec(file)?.[1] ?? ''
  const current = readPage(root, slug)
  if (!current) throw new Error('That page could not be read.')
  const designDir = path.join(root, 'design')
  if (!layoutExists(designDir, current.layout)) throw new Error(`The layout ${current.layout} no longer exists. Ask the chat to fix the page.`)
  const def = readLayout(designDir, current.layout)
  const title = Object.fromEntries(Object.entries(textValues(input.title, 'title', languages)).filter(([, text]) => text.trim()))
  const date = typeof input.date === 'string' && input.date.trim() ? input.date.trim().slice(0, 10) : undefined
  if (date && Number.isNaN(Date.parse(date))) throw new Error('The date must look like 2026-10-01.')
  const slots = validateSlots(def.slots, input.slots, languages)
  const problems = slots.errors.filter((error) => !MISSING.test(error))
  if (problems.length > 0) throw new Error(problems.slice(0, 3).join('. '))
  const page = { slug, layout: current.layout, date, title, slots: slots.value }
  const shape = checkPage(root, page).filter((error) => !MISSING.test(error))
  if (shape.length > 0) throw new Error(shape.slice(0, 3).join('. '))
  writePage(root, page)
}

function writeEventForm(root: string, full: string, input: Record<string, unknown>, site: ReturnType<typeof readSiteConfig>): void {
  const raw = readRaw(full)
  const known = readEventFields(root)
  const title = textValues(input.title, 'title', site.languages)
  const body = textValues(input.body, 'body', site.languages)
  const place = typeof input.place === 'string' ? input.place : ''
  if (!place || !fs.existsSync(path.join(root, 'content', 'places', `${place}.yml`))) throw new Error('Choose a place that exists.')
  const categories = stringList(input.categories ?? [], 'categories')
  const categoryField = known.find((field) => field.id === 'categories')
  // An id the design no longer offers is ignored, so one the event already had stays; a new one has to exist.
  const hadCategories = new Set(Array.isArray(raw.categories) ? raw.categories.map(String) : [])
  for (const id of categories) {
    if (categoryField && !categoryField.options.some((option) => option.id === id) && !hadCategories.has(id)) throw new Error(`Unknown category ${id}`)
  }
  const hadFields = textMap(raw.fields)
  const fields: Record<string, string> = {}
  for (const field of known.filter((item) => item.id !== 'categories')) {
    const value = input[`field:${field.id}`]
    const ids = field.multiple ? stringList(value ?? [], field.id) : typeof value === 'string' && value ? [value] : []
    const had = new Set((hadFields[field.id] ?? '').split(',').map((item) => item.trim()))
    for (const id of ids) {
      if (!field.options.some((option) => option.id === id) && !had.has(id)) throw new Error(`Unknown option ${id} for ${field.id}`)
    }
    if (ids.length > 0) fields[field.id] = ids.join(', ')
  }
  const before = Array.isArray(raw.dates) ? (raw.dates as { start?: unknown; end?: unknown }[]) : []
  if (!Array.isArray(input.dates) || input.dates.length === 0) throw new Error('An event needs at least one date.')
  const dates = (input.dates as { start?: unknown; end?: unknown }[]).map((date, index) => {
    const keep = (wall: unknown, original: unknown): string => {
      if (typeof wall !== 'string' || !wall) return ''
      // A time the person did not touch keeps the way it was written.
      if (typeof original === 'string' && toWall(original, site.timezone) === wall) return original
      return fromWall(wall, site.timezone)
    }
    const start = keep(date.start, before[index]?.start)
    if (!start) throw new Error(`Date ${index + 1} needs a start.`)
    const end = keep(date.end, before[index]?.end)
    if (end && Date.parse(end) < Date.parse(start)) throw new Error(`Date ${index + 1} ends before it starts.`)
    return end ? { start, end } : { start }
  })
  const next: Record<string, unknown> = { ...raw, title, body, place, categories, dates }
  if (Object.keys(fields).length > 0) next.fields = fields
  else delete next.fields
  fs.writeFileSync(full, stringify(next))
}

function writePlaceForm(full: string, input: Record<string, unknown>, languages: { id: string }[]): void {
  const raw = readRaw(full)
  const name = textValues(input.name, 'name', languages)
  if (!Object.values(name).some((text) => text.trim())) throw new Error('A place needs a name.')
  const next: Record<string, unknown> = { ...raw, name, onPremises: input.onPremises === true }
  const address = typeof input.address === 'string' ? input.address.trim() : ''
  if (address) next.address = address
  else delete next.address
  fs.writeFileSync(full, stringify(next))
}

function writeHomeForm(root: string, full: string, input: Record<string, unknown>): void {
  const raw = readRaw(full)
  const news = stringList(input.news ?? [], 'news')
  const slugs = new Set(listPageSlugs(root))
  for (const slug of news) if (!slugs.has(slug)) throw new Error(`There is no page ${slug}.`)
  fs.writeFileSync(full, stringify({ ...raw, news }))
}

function writeRedirectsForm(full: string, input: Record<string, unknown>): void {
  if (!Array.isArray(input.redirects)) throw new Error('The redirects must be a list.')
  const redirects = (input.redirects as { from?: unknown; to?: unknown }[]).map((item, index) => {
    const from = typeof item.from === 'string' ? item.from.trim() : ''
    const to = typeof item.to === 'string' ? item.to.trim() : ''
    if (!from.startsWith('/')) throw new Error(`Redirect ${index + 1}: the address to leave starts with /.`)
    if (!/^(\/|https?:\/\/)/.test(to)) throw new Error(`Redirect ${index + 1}: the target starts with / or https://.`)
    return { from, to }
  })
  fs.writeFileSync(full, stringify(redirects))
}
