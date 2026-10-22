import type { SlotDef, SlotSchema } from '@schlor/generator'
import { fail } from './tool-kit'

export type SlotPath = (string | number)[]

/** `cards.2.title` as ['cards', 2, 'title']. */
export function slotPath(text: string): SlotPath {
  const parts = text.trim().split('.').filter(Boolean)
  if (parts.length === 0) fail('slot is required, such as body or cards.2.title.')
  return parts.map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}

/** The slot definition at a path, or why there is none. */
export function slotDefAt(schema: SlotSchema, parts: SlotPath): SlotDef {
  const first = parts[0]
  if (typeof first !== 'string' || !schema[first]) fail(`Unknown slot ${String(first)}. This layout has: ${Object.keys(schema).join(', ') || 'no slots'}.`)
  let def = schema[first]
  let where = first
  for (const part of parts.slice(1)) {
    if (def.type === 'list') {
      if (typeof part !== 'number') fail(`${where} is a list. Use an index, such as ${where}.0.`)
      def = def.of as SlotDef
    } else if (def.type === 'group') {
      const fields = def.fields ?? {}
      if (typeof part !== 'string' || !fields[part]) fail(`${where} has the fields ${Object.keys(fields).join(', ')}.`)
      def = fields[part]
    } else {
      fail(`${where} is ${def.type}, so there is nothing below it.`)
    }
    where = `${where}.${part}`
  }
  return def
}

export function valueAt(slots: unknown, parts: SlotPath): unknown {
  let current: unknown = slots
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[part]
  }
  return current
}

/** Set a value in a copy of the slots. null removes it. A list grows by one at its end, not further. */
export function withValueAt(slots: Record<string, unknown>, parts: SlotPath, value: unknown): Record<string, unknown> {
  const copy = structuredClone(slots)
  let current: Record<string | number, unknown> = copy
  parts.forEach((part, index) => {
    const last = index === parts.length - 1
    if (Array.isArray(current) && typeof part === 'number' && part > current.length) {
      fail(`The list has ${current.length} items, so ${part} is too far. Use ${current.length} to add one.`)
    }
    if (last) {
      if (value === null) {
        if (Array.isArray(current)) current.splice(Number(part), 1)
        else delete current[part]
      } else {
        current[part] = value
      }
      return
    }
    let next = current[part]
    if (next === undefined || next === null || typeof next !== 'object') {
      next = typeof parts[index + 1] === 'number' ? [] : {}
      current[part] = next
    }
    current = next as Record<string | number, unknown>
  })
  return copy
}
