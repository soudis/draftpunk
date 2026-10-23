import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify } from 'yaml'

export type SiteLanguage = {
  id: string
  label: string
  optional: boolean
}

export type SiteConfig = {
  name: string
  id: string
  /** The address of the published site, such as https://schlor.org. Needed for the sitemap and canonical addresses. */
  url?: string
  timezone: string
  languages: SiteLanguage[]
  /** Pictures that belong to the whole site, by name: logo, favicon, social. Each is an address under /media/. */
  assets: Record<string, string>
}

export const ASSET_NAME = /^[a-z][a-z0-9-]{0,30}$/
export const ASSET_ADDRESS = /^\/media\/[^\s"'()<>]+$/

/** Why a set of site pictures cannot be used: a name that is not a word, an address outside /media/, or a picture that is not in the site. */
export function assetProblems(root: string, assets: Record<string, unknown>): string[] {
  const problems: string[] = []
  for (const [name, value] of Object.entries(assets)) {
    const address = String(value ?? '').trim()
    if (!ASSET_NAME.test(name)) problems.push(`assets.${name}: the name must be lowercase words with dashes, such as logo or hero-pattern`)
    else if (!ASSET_ADDRESS.test(address)) problems.push(`assets.${name}: ${address || 'empty'} is not a picture address such as /media/logo.png`)
    else if (!fs.existsSync(path.join(root, address.replace(/^\//, '')))) problems.push(`assets.${name}: ${address} is not in this site. Save the picture with save_picture first.`)
  }
  return problems
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
    url?: string
    timezone?: string
    languages?: { id?: string; label?: string; optional?: boolean }[]
    assets?: Record<string, unknown>
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
    url: siteUrl(raw.url) ?? siteUrl(process.env.SITE_URL),
    id: SITE_ID.test(requested) ? requested : SITE_ID.test(fromDir) ? fromDir : 'site',
    timezone: validTimeZone(String(raw.timezone ?? '').trim() || 'Europe/Vienna'),
    languages: chosen,
    assets: Object.fromEntries(
      Object.entries(raw.assets && typeof raw.assets === 'object' ? raw.assets : {})
        .map(([name, value]) => [name, String(value ?? '').trim()] as const)
        .filter(([name, value]) => ASSET_NAME.test(name) && ASSET_ADDRESS.test(value)),
    ),
  }
}

function siteUrl(value: unknown): string | undefined {
  const text = String(value ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(text) ? text : undefined
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

const LABEL_NAME = /^[a-z][a-z0-9_]*$/

/** Labels as a name with a text per language. Accepts the text of labels.yml too, which models sometimes send. */
export function parseLabels(value: unknown): Record<string, Record<string, string>> {
  let raw = value
  if (typeof raw === 'string') {
    try {
      raw = parse(raw)
    } catch (error) {
      throw new Error(`labels is not valid YAML: ${error instanceof Error ? error.message.split('\n')[0] : 'unreadable'}`)
    }
  }
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('labels must be an object of label names, each with a text per language')
  const labels: Record<string, Record<string, string>> = {}
  for (const [name, texts] of Object.entries(raw as Record<string, unknown>)) {
    if (!LABEL_NAME.test(name)) throw new Error(`Label name ${name} must be lowercase words with underscores, such as read_more`)
    if (!texts || typeof texts !== 'object' || Array.isArray(texts) || Object.values(texts).some((text) => typeof text !== 'string')) {
      throw new Error(`Label ${name} must be an object with one text per language, such as {"de":"Mehr","en":"More"}`)
    }
    labels[name] = { ...(texts as Record<string, string>) }
  }
  return labels
}

export function labelNames(root: string): string[] {
  return Object.keys(readYamlFile<Record<string, unknown>>(path.join(root, 'design', 'labels.yml'), {}) ?? {})
}

export function readLabels(root: string, lang: string): Record<string, string> {
  const raw = readYamlFile<Record<string, unknown>>(path.join(root, 'design', 'labels.yml'), {})
  const first = readSiteConfig(root).languages[0]?.id ?? lang
  const labels: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (typeof value === 'string') labels[key] = value
    else if (value && typeof value === 'object') {
      const texts = value as Record<string, unknown>
      const text = texts[lang] ?? texts[first] ?? Object.values(texts).find((item) => typeof item === 'string')
      if (typeof text === 'string') labels[key] = text
    }
  }
  return labels
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
