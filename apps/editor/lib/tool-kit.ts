import { jsonSchema, tool } from 'ai'
import { z } from 'zod'

/**
 * A tool failure the model can act on. Tools throw this instead of returning an
 * error sentence, so every refusal is a tool error in the chat, in the step log,
 * and in the model's own history.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

export function fail(message: string): never {
  throw new ToolError(message)
}

type JsonSchema = Record<string, unknown>

export function inputJsonSchema(schema: z.ZodType): JsonSchema {
  const raw = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as JsonSchema
  return stripUnsupported(raw) as JsonSchema
}

// Some providers reject these keywords, and the model gains nothing from them.
function stripUnsupported(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsupported)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '$schema' || key === 'propertyNames') continue
    out[key] = stripUnsupported(item)
  }
  return out
}

/**
 * Models often send a list or an object as a JSON string. When a field is not
 * allowed to be a string and arrives as one that parses, use the parsed value.
 */
export function coerceInput(schema: JsonSchema, raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== 'string') continue
    const property = properties[key]
    if (!property || allowsString(property)) continue
    const trimmed = value.trim()
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) continue
    try {
      out[key] = JSON.parse(trimmed)
    } catch {
      // Leave it. The schema check names the field.
    }
  }
  return out
}

function allowsString(property: JsonSchema): boolean {
  if (property.type === 'string') return true
  const options = (property.anyOf ?? property.oneOf) as JsonSchema[] | undefined
  return Array.isArray(options) && options.some(allowsString)
}

export function describeIssues(error: z.ZodError, raw: unknown): string {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const lines = new Set<string>()
  for (const issue of error.issues) {
    const where = issue.path.join('.')
    const top = issue.path[0]
    const missing = issue.path.length === 1 && (top === undefined || record[String(top)] === undefined)
    if (missing) lines.add(`${where} is required`)
    else if (issue.code === 'invalid_union') lines.add(`${where || 'input'} has the wrong shape`)
    else lines.add(`${where || 'input'}: ${issue.message.replace(/^Invalid input: /, '')}`)
  }
  return [...lines].join('; ')
}

type Define<S extends z.ZodType> = {
  description: string
  input: S
  execute: (input: z.infer<S>) => Promise<unknown> | unknown
}

/**
 * A tool whose input is checked here instead of by the SDK. A failed check throws a
 * short ToolError that names the fields. The SDK's own error repeats the whole input,
 * which for a page body costs a second copy of it in the next prompt.
 */
export function defineTool<S extends z.ZodType>(name: string, definition: Define<S>) {
  const schema = inputJsonSchema(definition.input)
  return tool({
    description: definition.description,
    inputSchema: jsonSchema<z.infer<S>>(schema as never, {
      validate: (value) => ({ success: true, value: value as z.infer<S> }),
    }),
    execute: async (raw: unknown) => {
      const parsed = definition.input.safeParse(coerceInput(schema, raw))
      if (!parsed.success) {
        fail(`${name}: ${describeIssues(parsed.error, raw)}. Nothing was changed.`)
      }
      try {
        return await definition.execute(parsed.data)
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw new ToolError(error instanceof Error ? error.message : String(error))
      }
    },
  })
}
