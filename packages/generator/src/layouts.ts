import fs from 'node:fs'
import path from 'node:path'
import nunjucks from 'nunjucks'
import { parse, stringify } from 'yaml'
import { parseSlotSchema, serializeSlotSchema, slotSignature, type SlotSchema } from './slots'

/** Layouts the generator fills with site data. A page never uses them. */
export const GENERATED_LAYOUTS = ['event', 'calendar', 'archive', 'notfound', 'search'] as const
export const REQUIRED_LAYOUTS = GENERATED_LAYOUTS

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type LayoutDef = {
  name: string
  kind: 'page' | 'generated'
  purpose: string
  slots: SlotSchema
}

export type LayoutFiles = { layout: string; template: string; style: string }

export function assertLayoutName(name: string): void {
  if (!NAME.test(name)) throw new Error(`Layout name must be lowercase words: ${name}`)
}

export function layoutFolder(designDir: string, name: string): string {
  assertLayoutName(name)
  return path.join(designDir, 'layouts', name)
}

export function layoutTemplatePath(name: string): string {
  return `layouts/${name}/template.njk`
}

export function listLayoutNames(designDir: string): string[] {
  const dir = path.join(designDir, 'layouts')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'layout.yml')))
    .map((entry) => entry.name)
    .sort()
}

export function pageLayouts(designDir: string): string[] {
  const generated = new Set<string>(GENERATED_LAYOUTS)
  return listLayoutNames(designDir).filter((name) => !generated.has(name))
}

export function layoutExists(designDir: string, name: string): boolean {
  return NAME.test(name) && fs.existsSync(path.join(designDir, 'layouts', name, 'layout.yml'))
}

export function readLayout(designDir: string, name: string): LayoutDef {
  const file = path.join(layoutFolder(designDir, name), 'layout.yml')
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown layout ${name}. Choose one of: ${pageLayouts(designDir).join(', ') || 'none yet'}`)
  }
  const raw = (parse(fs.readFileSync(file, 'utf8')) ?? {}) as { purpose?: unknown; kind?: unknown; slots?: unknown }
  let slots: SlotSchema
  try {
    slots = parseSlotSchema(raw.slots)
  } catch (error) {
    throw new Error(`Layout ${name}: ${error instanceof Error ? error.message : 'the slots cannot be read'}`)
  }
  return {
    name,
    kind: (GENERATED_LAYOUTS as readonly string[]).includes(name) || raw.kind === 'generated' ? 'generated' : 'page',
    purpose: typeof raw.purpose === 'string' ? raw.purpose.trim() : '',
    slots,
  }
}

/** The purpose and the slots as written in a layout.yml text. */
export function parseLayoutFile(text: string): { purpose: string; slots: unknown } {
  let raw: unknown
  try {
    raw = parse(text)
  } catch (error) {
    throw new Error(`layout.yml is not valid YAML: ${error instanceof Error ? error.message.split('\n')[0] : 'unreadable'}`)
  }
  const record = (raw && typeof raw === 'object' ? raw : {}) as { purpose?: unknown; slots?: unknown }
  return { purpose: typeof record.purpose === 'string' ? record.purpose : '', slots: record.slots ?? {} }
}

export function readLayoutFiles(designDir: string, name: string): LayoutFiles {
  const folder = layoutFolder(designDir, name)
  const read = (file: string) => (fs.existsSync(path.join(folder, file)) ? fs.readFileSync(path.join(folder, file), 'utf8') : '')
  return { layout: read('layout.yml'), template: read('template.njk'), style: read('style.css') }
}

export type LayoutCheck = { errors: string[]; warnings: string[] }

const SLOT_REF = /\bslots\.([A-Za-z_][A-Za-z0-9_]*)|\bslots\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g

const LABEL_REF = /\blabels\.([A-Za-z_][A-Za-z0-9_]*)|\blabels\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g

/** Names under `labels` that a template reads. */
export function labelReferences(template: string): string[] {
  const found = new Set<string>()
  for (const match of template.matchAll(LABEL_REF)) found.add(match[1] ?? match[2])
  return [...found]
}

/** Names under `slots` that a template reads. */
export function slotReferences(template: string): string[] {
  const found = new Set<string>()
  for (const match of template.matchAll(SLOT_REF)) found.add(match[1] ?? match[2])
  return [...found]
}

/** Syntax of the template, and that it reads the slots the layout declares and no others. */
export function checkLayout(def: Pick<LayoutDef, 'name' | 'kind' | 'slots'>, template: string): LayoutCheck {
  const errors: string[] = []
  const warnings: string[] = []
  try {
    // Compiling finds a syntax error without needing any page data.
    new nunjucks.Template(template, new nunjucks.Environment(), `${def.name}/template.njk`, true)
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^\(unknown path\)\s*/, '').replace(/\n/g, ' ') : 'The template does not compile'
    errors.push(`template.njk does not compile: ${message}`)
  }
  if (def.kind === 'generated') return { errors, warnings }
  const declared = Object.keys(def.slots)
  const read = slotReferences(template)
  const unknown = read.filter((name) => !declared.includes(name))
  if (unknown.length > 0) errors.push(`template.njk reads slots ${unknown.join(', ')} that layout.yml does not declare. Declared: ${declared.join(', ') || 'none'}`)
  const unused = declared.filter((name) => !read.includes(name))
  if (unused.length > 0) warnings.push(`slots ${unused.join(', ')} are declared but template.njk never shows them`)
  return { errors, warnings }
}

export type LayoutInput = { name: string; purpose: string; slots: unknown; template: string; style?: string }

/** Write the three files of a layout. Nothing is written when the layout is invalid. */
export function writeLayout(designDir: string, input: LayoutInput): { warnings: string[] } {
  assertLayoutName(input.name)
  if ((GENERATED_LAYOUTS as readonly string[]).includes(input.name)) throw new Error(`Layout ${input.name} is generated. Edit its template instead of replacing it.`)
  if (!input.purpose.trim()) throw new Error('A layout needs a purpose: one line that says what pages it is for.')
  let slots: SlotSchema
  try {
    slots = parseSlotSchema(input.slots)
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'The slots cannot be read')
  }
  const checked = checkLayout({ name: input.name, kind: 'page', slots }, input.template)
  if (checked.errors.length > 0) throw new Error(checked.errors.join('. '))
  const folder = layoutFolder(designDir, input.name)
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, 'layout.yml'), stringify({ purpose: input.purpose.trim(), slots: serializeSlotSchema(slots) }))
  fs.writeFileSync(path.join(folder, 'template.njk'), input.template)
  if (input.style !== undefined) fs.writeFileSync(path.join(folder, 'style.css'), input.style)
  else if (!fs.existsSync(path.join(folder, 'style.css'))) fs.writeFileSync(path.join(folder, 'style.css'), '')
  return { warnings: checked.warnings }
}

export function forkLayout(designDir: string, from: string, to: string): void {
  assertLayoutName(to)
  const source = layoutFolder(designDir, from)
  if (!fs.existsSync(source)) throw new Error(`Unknown layout ${from}`)
  if ((GENERATED_LAYOUTS as readonly string[]).includes(to)) throw new Error(`${to} is a generated layout name`)
  const target = layoutFolder(designDir, to)
  if (fs.existsSync(target)) throw new Error(`Layout ${to} exists. Choose another name.`)
  fs.cpSync(source, target, { recursive: true })
}

export function removeLayoutFolder(designDir: string, name: string): void {
  if ((GENERATED_LAYOUTS as readonly string[]).includes(name)) {
    throw new Error(`Layout ${name} is part of the calendar and archive. Overwrite its template instead of removing it.`)
  }
  fs.rmSync(layoutFolder(designDir, name), { recursive: true, force: true })
}

export type CatalogEntry = {
  name: string
  kind: 'page' | 'generated'
  purpose: string
  signature: string
  pages: string[]
  /** Other layouts that take exactly the same slots. A hint to merge, never a rule. */
  similar: string[]
}

/** What the agent sees of the site's layouts: what each is for, what it takes, and who uses it. */
export function layoutCatalog(designDir: string, pagesByLayout: Map<string, string[]>): CatalogEntry[] {
  const entries = layoutEntries(designDir, pagesByLayout)
  return entries.map((entry) => ({
    ...entry,
    similar:
      entry.kind === 'page' && entry.signature !== '(no slots)'
        ? entries.filter((other) => other.name !== entry.name && other.kind === 'page' && other.signature === entry.signature).map((other) => other.name)
        : [],
  }))
}

function layoutEntries(designDir: string, pagesByLayout: Map<string, string[]>): Omit<CatalogEntry, 'similar'>[] {
  return listLayoutNames(designDir).flatMap((name) => {
    try {
      const def = readLayout(designDir, name)
      return [
        {
          name,
          kind: def.kind,
          purpose: def.purpose,
          signature: def.kind === 'generated' ? 'filled by the generator' : slotSignature(def.slots),
          pages: pagesByLayout.get(name) ?? [],
        },
      ]
    } catch (error) {
      return [{ name, kind: 'page' as const, purpose: '', signature: `broken: ${error instanceof Error ? error.message : 'unreadable'}`, pages: pagesByLayout.get(name) ?? [] }]
    }
  })
}

export function formatCatalog(entries: CatalogEntry[]): string {
  return entries
    .map((entry) => {
      const used = entry.pages.length === 0 ? 'unused' : entry.pages.length <= 3 ? entry.pages.join(', ') : `${entry.pages.length} pages`
      const purpose = entry.purpose ? ` — ${entry.purpose}` : ''
      const similar = entry.similar.length > 0 ? `\n  same slots as: ${entry.similar.join(', ')}` : ''
      return `- ${entry.name}${purpose}\n  slots: ${entry.signature}\n  used by: ${used}${similar}`
    })
    .join('\n')
}

const GLOBAL_AT_RULES = /^@(?:keyframes|font-face|property|import|layer|theme|source|plugin|tailwind|utility|custom-variant|variant|config)\b/

/**
 * Nest a layout's styles under that layout, so one layout cannot restyle another.
 * Rules that cannot be nested (keyframes, font-face, imports) stay where they are.
 */
export function scopeLayoutCss(name: string, css: string): string {
  const parts = topLevel(css)
  const global: string[] = []
  const local: string[] = []
  for (const part of parts) (GLOBAL_AT_RULES.test(part.trimStart()) ? global : local).push(part.trim())
  const nested = local.filter(Boolean).join('\n')
  const scoped = nested ? `body[data-layout="${name}"] {\n${nested}\n}` : ''
  return [...global, scoped].filter(Boolean).join('\n')
}

// Split CSS into its top-level statements and blocks, ignoring braces in comments and strings.
function topLevel(css: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let quote = ''
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2)
      index = end === -1 ? css.length : end + 1
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        parts.push(css.slice(start, index + 1))
        start = index + 1
      }
    } else if (char === ';' && depth === 0) {
      parts.push(css.slice(start, index + 1))
      start = index + 1
    }
  }
  if (css.slice(start).trim()) parts.push(css.slice(start))
  return parts
}
