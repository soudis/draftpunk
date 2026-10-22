import type { SiteLanguage } from './model'

export const SLOT_TYPES = ['text', 'markdown', 'image', 'link', 'date', 'list', 'group'] as const
export type SlotType = (typeof SLOT_TYPES)[number]

export type SlotDef = {
  type: SlotType
  /** Text and markdown hold one entry per language. Everything else is stored once. */
  translate: boolean
  required: boolean
  /** The item of a list. */
  of?: SlotDef
  /** The fields of a group. */
  fields?: SlotSchema
}

export type SlotSchema = Record<string, SlotDef>

// Names a page keeps for itself, or that a template already has in scope.
const RESERVED = new Set(['title', 'date', 'layout', 'slug', 'lang', 'labels', 'slots'])
const NAME = /^[a-z][a-z0-9_]*$/

export function isSlotName(name: string): boolean {
  return NAME.test(name) && !RESERVED.has(name)
}

/** Read a slot schema as written in layout.yml. Throws a sentence that names the slot and the problem. */
export function parseSlotSchema(raw: unknown, where = 'slots', top = true): SlotSchema {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where} must be an object of slot names`)
  const schema: SlotSchema = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!NAME.test(name)) throw new Error(`${where}: slot name ${name} must be lowercase letters, digits and underscores, starting with a letter`)
    if (top && RESERVED.has(name)) throw new Error(`${where}: ${name} is a reserved name. A page already has title, date, and layout.`)
    schema[name] = parseSlot(value, `${where}.${name}`)
  }
  return schema
}

function parseSlot(value: unknown, where: string): SlotDef {
  if (typeof value === 'string') return fromType(value, {}, where)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be a type such as text, or an object with a type`)
  const record = value as Record<string, unknown>
  if (!('type' in record)) {
    // A bare map of fields is a group.
    return { type: 'group', translate: false, required: false, fields: parseSlotSchema(record, where, false) }
  }
  return fromType(String(record.type), record, where)
}

function fromType(type: string, options: Record<string, unknown>, where: string): SlotDef {
  if (!(SLOT_TYPES as readonly string[]).includes(type)) {
    throw new Error(`${where}: unknown type ${type}. Use ${SLOT_TYPES.join(', ')}.`)
  }
  const slotType = type as SlotType
  const text = slotType === 'text' || slotType === 'markdown'
  const def: SlotDef = {
    type: slotType,
    translate: typeof options.translate === 'boolean' ? options.translate : text,
    required: options.required === true,
  }
  if (!text && options.translate === true) throw new Error(`${where}: only text and markdown can be translated`)
  if (slotType === 'list') {
    if (options.of === undefined) throw new Error(`${where}: a list needs of, the type of one item`)
    def.of = parseSlot(options.of, `${where}.of`)
  }
  if (slotType === 'group') {
    if (options.fields === undefined) throw new Error(`${where}: a group needs fields`)
    def.fields = parseSlotSchema(options.fields, `${where}.fields`, false)
  }
  return def
}

/** The schema in the plain form layout.yml keeps. */
export function serializeSlotSchema(schema: SlotSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(schema)) out[name] = serializeSlot(def)
  return out
}

function serializeSlot(def: SlotDef): unknown {
  const text = def.type === 'text' || def.type === 'markdown'
  const plain = def.required === false && def.translate === text && !def.of && !def.fields
  if (plain) return def.type
  const out: Record<string, unknown> = { type: def.type }
  if (def.required) out.required = true
  if (def.translate !== text) out.translate = def.translate
  if (def.of) out.of = serializeSlot(def.of)
  if (def.fields) out.fields = serializeSlotSchema(def.fields)
  return out
}

/** One line a model can read: `lede:text, body:markdown*, facts:list<label:text, value:text>`. */
export function slotSignature(schema: SlotSchema): string {
  const entries = Object.entries(schema).map(([name, def]) => `${name}:${describe(def)}`)
  return entries.length === 0 ? '(no slots)' : entries.join(', ')
}

function describe(def: SlotDef): string {
  const star = def.required ? '*' : ''
  const text = def.type === 'text' || def.type === 'markdown'
  const shared = text && !def.translate ? ' shared' : ''
  if (def.type === 'list') return `list<${def.of ? describe(def.of) : '?'}>${star}`
  if (def.type === 'group') return `{${Object.entries(def.fields ?? {}).map(([name, field]) => `${name}:${describe(field)}`).join(', ')}}${star}`
  return `${def.type}${shared}${star}`
}

export type SlotCheck = { value: Record<string, unknown>; errors: string[] }

/**
 * Check slot values against a schema. Translated text must be an object of language ids.
 * A language that is not optional must have text when the slot is required.
 */
export function validateSlots(schema: SlotSchema, values: unknown, languages: SiteLanguage[]): SlotCheck {
  const errors: string[] = []
  const input = values === undefined || values === null ? {} : values
  if (typeof input !== 'object' || Array.isArray(input)) return { value: {}, errors: ['slots must be an object'] }
  const record = input as Record<string, unknown>
  const names = Object.keys(schema)
  for (const key of Object.keys(record)) {
    if (!schema[key]) errors.push(`unknown slot ${key}. This layout has: ${names.join(', ') || 'no slots'}`)
  }
  const value: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(schema)) {
    const found = check(def, record[name], `slots.${name}`, languages, errors)
    if (found !== undefined) value[name] = found
  }
  return { value, errors }
}

function empty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(empty)
  return false
}

function check(def: SlotDef, value: unknown, where: string, languages: SiteLanguage[], errors: string[]): unknown {
  if (empty(value)) {
    if (def.required) errors.push(`${where} is required${def.translate ? ` in every language that is not optional (${languages.filter((l) => !l.optional).map((l) => l.id).join(', ')})` : ''}`)
    return undefined
  }
  switch (def.type) {
    case 'text':
    case 'markdown':
      return def.translate ? checkTranslated(def, value, where, languages, errors) : checkString(value, where, errors)
    case 'image': {
      const text = checkString(value, where, errors)
      if (text !== undefined && !/^(\/media\/|https?:\/\/)/.test(text)) errors.push(`${where} must be a picture address such as /media/hof.webp`)
      return text
    }
    case 'link': {
      const text = checkString(value, where, errors)
      if (text !== undefined && !/^(\/|#|https?:\/\/|mailto:|tel:)/.test(text)) errors.push(`${where} must be an address starting with /, https://, mailto:, or tel:`)
      return text
    }
    case 'date': {
      const text = checkString(value, where, errors)
      if (text !== undefined && Number.isNaN(Date.parse(text))) errors.push(`${where} must be a date such as 2026-10-01`)
      return text
    }
    case 'list': {
      if (!Array.isArray(value)) {
        errors.push(`${where} must be a list`)
        return undefined
      }
      const items = value.map((item, index) => check(def.of as SlotDef, item, `${where}.${index}`, languages, errors))
      return items.filter((item) => item !== undefined)
    }
    case 'group': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${where} must be an object with ${Object.keys(def.fields ?? {}).join(', ')}`)
        return undefined
      }
      const record = value as Record<string, unknown>
      const fields = def.fields ?? {}
      for (const key of Object.keys(record)) if (!fields[key]) errors.push(`${where}.${key} is not a field. Use ${Object.keys(fields).join(', ')}`)
      const out: Record<string, unknown> = {}
      for (const [name, field] of Object.entries(fields)) {
        const found = check(field, record[name], `${where}.${name}`, languages, errors)
        if (found !== undefined) out[name] = found
      }
      return out
    }
  }
}

function checkString(value: unknown, where: string, errors: string[]): string | undefined {
  if (typeof value !== 'string') {
    errors.push(`${where} must be text`)
    return undefined
  }
  return value
}

function checkTranslated(def: SlotDef, value: unknown, where: string, languages: SiteLanguage[], errors: string[]): Record<string, string> | undefined {
  if (typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${where} must be an object with one text per language, such as {"${languages[0]?.id ?? 'de'}":"…"}`)
    return undefined
  }
  const record = value as Record<string, unknown>
  const known = new Set(languages.map((language) => language.id))
  const out: Record<string, string> = {}
  for (const [id, text] of Object.entries(record)) {
    if (!known.has(id)) errors.push(`${where}: unknown language ${id}. Use ${[...known].join(', ')}`)
    else if (typeof text !== 'string') errors.push(`${where}.${id} must be text`)
    else if (text.trim()) out[id] = text
  }
  if (def.required) {
    for (const language of languages) {
      if (!language.optional && !out[language.id]) errors.push(`${where}.${language.id} is required`)
    }
  }
  return out
}

/** The slot values without the texts of languages the site does not have. A slot the layout does not have is left alone. */
export function withoutLanguages(schema: SlotSchema, values: unknown, languages: SiteLanguage[]): unknown {
  const known = new Set(languages.map((language) => language.id))
  const strip = (def: SlotDef, value: unknown): unknown => {
    if ((def.type === 'text' || def.type === 'markdown') && def.translate) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([id]) => known.has(id)))
    }
    if (def.type === 'list') return Array.isArray(value) ? value.map((item) => strip(def.of as SlotDef, item)) : value
    if (def.type === 'group') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      const fields = def.fields ?? {}
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, field]) => [name, fields[name] ? strip(fields[name], field) : field]))
    }
    return value
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) return values
  return Object.fromEntries(Object.entries(values as Record<string, unknown>).map(([name, value]) => [name, schema[name] ? strip(schema[name], value) : value]))
}

export type SlotHooks = {
  /** Plain text. `path` is where the text lives in the page file, for the inline editor. */
  text: (source: string, path: string) => unknown
  /** Markdown source to what a template shows. */
  markdown: (source: string, path: string) => unknown
}

/** The values a template sees: one language picked, markdown turned into HTML. Lenient, it never throws. */
export function resolveSlots(schema: SlotSchema, values: Record<string, unknown>, lang: string, hooks: SlotHooks): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(schema)) out[name] = resolve(def, values?.[name], `slots.${name}`, lang, hooks)
  return out
}

function resolve(def: SlotDef, value: unknown, path: string, lang: string, hooks: SlotHooks): unknown {
  switch (def.type) {
    case 'text':
    case 'markdown': {
      const source = def.translate ? pick(value, lang) : typeof value === 'string' ? value : ''
      const at = def.translate ? `${path}.${lang}` : path
      if (!source) return ''
      return def.type === 'markdown' ? hooks.markdown(source, at) : hooks.text(source, at)
    }
    case 'list':
      return Array.isArray(value) ? value.map((item, index) => resolve(def.of as SlotDef, item, `${path}.${index}`, lang, hooks)) : []
    case 'group': {
      const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
      const out: Record<string, unknown> = {}
      for (const [name, field] of Object.entries(def.fields ?? {})) out[name] = resolve(field, record[name], `${path}.${name}`, lang, hooks)
      return out
    }
    default:
      return typeof value === 'string' ? value : ''
  }
}

function pick(value: unknown, lang: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const text = (value as Record<string, unknown>)[lang]
  return typeof text === 'string' ? text : ''
}

/** Every string a person wrote in a slot value, with the language it is in, for checks that nothing was lost. */
export function slotTexts(schema: SlotSchema, values: Record<string, unknown>): { lang?: string; text: string; path: string }[] {
  const found: { lang?: string; text: string; path: string }[] = []
  const walk = (def: SlotDef, value: unknown, path: string) => {
    if (value === undefined || value === null) return
    if ((def.type === 'text' || def.type === 'markdown') && def.translate) {
      if (value && typeof value === 'object') {
        for (const [lang, text] of Object.entries(value as Record<string, unknown>)) if (typeof text === 'string' && text.trim()) found.push({ lang, text, path: `${path}.${lang}` })
      }
      return
    }
    if (def.type === 'text' || def.type === 'markdown') {
      if (typeof value === 'string' && value.trim()) found.push({ text: value, path })
      return
    }
    if (def.type === 'list' && Array.isArray(value)) value.forEach((item, index) => walk(def.of as SlotDef, item, `${path}.${index}`))
    if (def.type === 'group' && typeof value === 'object') {
      for (const [name, field] of Object.entries(def.fields ?? {})) walk(field, (value as Record<string, unknown>)[name], `${path}.${name}`)
    }
  }
  for (const [name, def] of Object.entries(schema)) walk(def, values[name], `slots.${name}`)
  return found
}
