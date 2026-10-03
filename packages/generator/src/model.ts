import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify } from 'yaml'

export const SECTION_SHAPES = [
  'title',
  'prose',
  'hero',
  'cards',
  'band',
  'pictures',
  'email',
  'picture-groups',
  'link-groups',
  'news',
  'upcoming',
] as const

export type SectionShape = (typeof SECTION_SHAPES)[number]

export type SectionDecl = {
  shape: SectionShape
  heading?: Record<string, string>
}

export type SiteLanguage = {
  id: string
  label: string
  optional: boolean
}

export type SiteConfig = {
  name: string
  id: string
  timezone: string
  languages: SiteLanguage[]
}

export type FieldOption = {
  id: string
  label: Record<string, string>
}

export type EventField = {
  id: string
  label: Record<string, string>
  show: boolean
  multiple: boolean
  options: FieldOption[]
}

const LANG_ID = /^[a-z]{2}(?:-[a-z0-9]+)*$/
const SITE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function readYamlFile<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback
  return parse(fs.readFileSync(file, 'utf8')) as T
}

export function writeYamlFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, stringify(value))
}

export function localeFor(lang: string): string {
  if (lang === 'de') return 'de-AT'
  if (lang === 'en') return 'en-GB'
  return lang
}

export function readSiteConfig(root: string): SiteConfig {
  const raw = readYamlFile<{
    name?: string
    id?: string
    timezone?: string
    languages?: { id?: string; label?: string; optional?: boolean }[]
  }>(path.join(root, 'design', 'site.yml'), {})
  const languages = (raw.languages ?? [])
    .map((lang) => ({
      id: String(lang.id ?? '').trim().toLowerCase(),
      label: String(lang.label ?? lang.id ?? '').trim(),
      optional: lang.optional === true,
    }))
    .filter((lang) => LANG_ID.test(lang.id))
  const fallback: SiteLanguage[] = [
    { id: 'de', label: 'Deutsch', optional: false },
    { id: 'en', label: 'English', optional: false },
  ]
  const chosen = languages.length > 0 ? languages : fallback
  const requested = String(raw.id ?? '').trim().toLowerCase()
  const fromDir = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return {
    name: String(raw.name ?? '').trim() || 'Website',
    id: SITE_ID.test(requested) ? requested : SITE_ID.test(fromDir) ? fromDir : 'site',
    timezone: validTimeZone(String(raw.timezone ?? '').trim() || 'Europe/Vienna'),
    languages: chosen,
  }
}

export function languageIds(root: string): string[] {
  return readSiteConfig(root).languages.map((lang) => lang.id)
}

export function requiredLanguages(root: string): string[] {
  return readSiteConfig(root).languages.filter((lang) => !lang.optional).map((lang) => lang.id)
}

function validTimeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(new Date())
    return zone
  } catch {
    return 'Europe/Vienna'
  }
}

export function readLayoutSections(designDir: string, name: string): SectionDecl[] | null {
  const file = path.join(designDir, 'layouts', `${name}.yml`)
  if (!fs.existsSync(file)) return null
  const raw = readYamlFile<{ sections?: { shape?: string; heading?: Record<string, string> }[] }>(file, {})
  return (raw.sections ?? []).map((section) => {
    const shape = String(section.shape ?? '')
    if (!SECTION_SHAPES.includes(shape as SectionShape)) {
      throw new Error(`Layout ${name} uses an unknown section shape: ${shape}`)
    }
    return { shape: shape as SectionShape, heading: section.heading }
  })
}

export function layoutHasTemplate(designDir: string, name: string): boolean {
  return fs.existsSync(path.join(designDir, 'layouts', `${name}.njk`))
}

export function readEventFields(root: string): EventField[] {
  const raw = readYamlFile<unknown>(path.join(root, 'design', 'fields.yml'), [])
  const fields = (Array.isArray(raw) ? raw : []).map(normalizeField).filter((field): field is EventField => Boolean(field))
  const categories = readCategoryOptions(root)
  if (categories.length === 0) return fields
  const existing = fields.find((field) => field.id === 'categories')
  const categoryField: EventField = {
    id: 'categories',
    label: existing?.label ?? { de: 'Kategorien', en: 'Categories' },
    show: existing?.show ?? false,
    multiple: true,
    options: categories,
  }
  return [categoryField, ...fields.filter((field) => field.id !== 'categories')]
}

function readCategoryOptions(root: string): FieldOption[] {
  const raw = readYamlFile<unknown>(path.join(root, 'design', 'categories.yml'), [])
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as { id?: string; de?: string; en?: string; label?: Record<string, string> }
    const id = String(record.id ?? '').trim()
    if (!id) return []
    const label = record.label ?? { de: String(record.de ?? id), en: String(record.en ?? record.de ?? id) }
    return [{ id, label }]
  })
}

function normalizeField(value: unknown): EventField | null {
  if (!value || typeof value !== 'object') return null
  const record = value as {
    id?: string
    label?: Record<string, string>
    show?: boolean
    multiple?: boolean
    options?: { id?: string; label?: Record<string, string>; de?: string; en?: string }[]
  }
  const id = String(record.id ?? '').trim()
  if (!id) return null
  const options = (record.options ?? []).flatMap((option) => {
    const optionId = String(option.id ?? '').trim()
    if (!optionId) return []
    const label = option.label ?? { de: String(option.de ?? optionId), en: String(option.en ?? option.de ?? optionId) }
    return [{ id: optionId, label }]
  })
  return {
    id,
    label: record.label ?? {},
    show: record.show === true,
    multiple: record.multiple === true || id === 'categories',
    options,
  }
}

export function optionLabel(field: EventField, optionId: string | undefined, lang: string): string | null {
  if (!optionId) return null
  const option = field.options.find((item) => item.id === optionId)
  if (!option) return null
  return option.label[lang] || Object.values(option.label)[0] || option.id
}

export function shownEventFields(
  event: { categories?: string[]; fields?: Record<string, string> },
  fields: EventField[],
  lang: string,
): { label: string; value: string }[] {
  const shown: { label: string; value: string }[] = []
  for (const field of fields) {
    if (!field.show) continue
    const ids = field.multiple
      ? field.id === 'categories'
        ? (event.categories ?? [])
        : String(event.fields?.[field.id] ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
      : [event.fields?.[field.id] ?? '']
    const values = ids.map((id) => optionLabel(field, id, lang)).filter((label): label is string => Boolean(label))
    if (values.length === 0) continue
    const label = field.label[lang] || Object.values(field.label)[0] || field.id
    shown.push({ label, value: values.join(', ') })
  }
  return shown
}

export function setupAccepted(root: string): boolean {
  const file = path.join(root, 'design', 'setup.yml')
  if (!fs.existsSync(file)) return true
  const raw = readYamlFile<{ accepted?: boolean }>(file, {})
  return raw.accepted === true
}
