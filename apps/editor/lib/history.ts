import type { ModelMessage } from 'ai'

// Tools whose result is only needed while the agent decides what to write. After the turn
// that read it, a stub is enough: the agent can read the file again.
const READ_TOOLS = new Set([
  'search_content',
  'list_pages',
  'read_page',
  'list_events',
  'read_event',
  'list_places',
  'read_place',
  'list_pictures',
  'read_picture',
  'list_design',
  'read_design',
  'read_website',
])

const STUB_OVER = 400
export const DEFAULT_BUDGET_CHARS = 500_000

type Part = { type: string; [key: string]: unknown }

function parts(message: ModelMessage): Part[] {
  return Array.isArray(message.content) ? (message.content as unknown as Part[]) : []
}

function withParts(message: ModelMessage, content: Part[]): ModelMessage {
  return { ...message, content } as unknown as ModelMessage
}

function lastUserIndex(messages: ModelMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index
  }
  return -1
}

function outputSize(output: unknown): number {
  return output === undefined ? 0 : JSON.stringify(output).length
}

function stubOutput(toolName: string, size: number): { type: 'text'; value: string } {
  return { type: 'text', value: `[Earlier ${toolName} result of ${size} characters dropped. Call ${toolName} again if you need it.]` }
}

function hasImage(output: unknown): boolean {
  const value = (output as { type?: string; value?: unknown } | undefined)?.value
  return (output as { type?: string } | undefined)?.type === 'content' && Array.isArray(value) && value.some((item) => (item as Part).type !== 'text')
}

function stubInput(toolName: string, input: unknown): unknown {
  if (!input || typeof input !== 'object') return input
  const record = { ...(input as Record<string, unknown>) }
  if (toolName === 'write_design' && typeof record.content === 'string' && record.content.length > STUB_OVER) {
    record.content = `[${record.content.length} characters were written. Call read_design to see the file.]`
  }
  if (toolName === 'write_page' && record.languages && typeof record.languages === 'object') {
    const languages: Record<string, unknown> = {}
    for (const [id, text] of Object.entries(record.languages as Record<string, { title?: string; body?: string }>)) {
      const body = typeof text?.body === 'string' ? text.body : ''
      languages[id] = { ...text, body: body.length > STUB_OVER ? `[${body.length} characters were written. Call read_page to see the page.]` : body }
    }
    record.languages = languages
  }
  return record
}

/** Prune what the agent no longer needs from earlier turns, and drop images once their step is over. */
export function pruneHistory(messages: ModelMessage[], budgetChars = DEFAULT_BUDGET_CHARS): ModelMessage[] {
  const turnStart = lastUserIndex(messages)
  const lastToolMessage = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index].role === 'tool') return index
    return -1
  })()
  const pruned = messages.map((message, index) => {
    const older = index < turnStart
    if (message.role === 'tool') {
      return withParts(
        message,
        parts(message).map((part) => {
          if (part.type !== 'tool-result') return part
          const toolName = String(part.toolName)
          const size = outputSize(part.output)
          const spentImage = hasImage(part.output) && index !== lastToolMessage
          if (spentImage || (older && READ_TOOLS.has(toolName) && size > STUB_OVER)) return { ...part, output: stubOutput(toolName, size) }
          return part
        }),
      )
    }
    if (message.role === 'assistant' && older) {
      return withParts(
        message,
        parts(message)
          .filter((part) => part.type !== 'reasoning')
          .map((part) => (part.type === 'tool-call' ? { ...part, input: stubInput(String(part.toolName), part.input) } : part)),
      )
    }
    return message
  })
  return fitBudget(pruned, turnStart, budgetChars)
}

function size(messages: ModelMessage[]): number {
  return messages.reduce((total, message) => total + JSON.stringify(message.content).length, 0)
}

// When even the pruned history is too long, drop the tool traffic of the oldest turns and keep what was said.
function fitBudget(messages: ModelMessage[], turnStart: number, budgetChars: number): ModelMessage[] {
  if (size(messages) <= budgetChars) return messages
  const kept = [...messages]
  let index = 0
  while (index < turnStart && size(kept) > budgetChars) {
    const message = kept[index]
    if (message.role === 'tool') {
      kept.splice(index, 1)
      turnStart -= 1
      continue
    }
    if (message.role === 'assistant') {
      const text = parts(message).filter((part) => part.type === 'text')
      if (text.length === 0) {
        kept.splice(index, 1)
        turnStart -= 1
        continue
      }
      kept[index] = withParts(message, text)
    }
    index += 1
  }
  return kept
}
