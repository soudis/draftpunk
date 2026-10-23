import type { ModelMessage } from 'ai'
import { stripLeakedCalls } from './leaked-calls'

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
// About 65k tokens (3.7 characters a token in the first real setup). A longer history costs a lot on every step and the
// model reads the middle of it badly; what the site itself shows (the files, the catalog) replaces what is cut.
export const DEFAULT_BUDGET_CHARS = 250_000
// The cut moves only every second turn, and only when the finished turns plus this room for the turn that is running
// no longer fit. Between moves the start of the history is the same in every request, so the provider's cache holds it.
const ANCHOR_EVERY = 2
const TURN_ROOM = 60_000
const turnRoom = (budgetChars: number) => Math.min(TURN_ROOM, Math.floor(budgetChars / 4))

export const COMPACTED_NOTE =
  'Note: the tool work of the earlier turns of this chat was dropped to keep it short. What was said is kept. What was done is in the site: read a page, a layout or a file again if you need its text.'

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
export function pruneHistory(messages: ModelMessage[], budgetChars = DEFAULT_BUDGET_CHARS, options: { keepReasoning?: boolean } = {}): ModelMessage[] {
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
          .filter((part) => options.keepReasoning || part.type !== 'reasoning')
          .map((part) => (part.type === 'tool-call' ? { ...part, input: stubInput(String(part.toolName), part.input) } : part)),
      )
    }
    return message
  })
  const stubbed = pruned.map(withoutLeakedCalls)
  // Whether to cut depends on the finished turns only, so it does not flip while the running turn grows.
  if (size(stubbed.slice(0, turnStart)) + turnRoom(budgetChars) <= budgetChars) return repairHistory(stubbed)
  return repairHistory(cutAtAnchor(stubbed, turnStart, budgetChars, options.keepReasoning === true) ?? fitBudget(stubbed, turnStart, budgetChars, options.keepReasoning === true))
}

// A tool call that the model wrote as text, and that never ran, is not sent back.
function withoutLeakedCalls(message: ModelMessage): ModelMessage {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return message
  return withParts(
    message,
    parts(message).map((part) => (part.type === 'text' ? { ...part, text: stripLeakedCalls(String(part.text ?? '')) } : part)),
  )
}

function size(messages: ModelMessage[]): number {
  return messages.reduce((total, message) => total + JSON.stringify(message.content).length, 0)
}

/**
 * Turns before an anchor (every second turn, counted from the first) keep only what was said, and the turns from the anchor on
 * stay whole. The anchor is the earliest one from which the finished turns, with room for the running one, fit the
 * budget. It moves rarely, so the cache of the provider keeps the history between moves. Null when no anchor helps.
 */
function cutAtAnchor(messages: ModelMessage[], turnStart: number, budgetChars: number, keepReasoning: boolean): ModelMessage[] | null {
  const users = messages.flatMap((message, index) => (message.role === 'user' ? [index] : []))
  for (let anchor = 2; anchor < users.length; anchor += ANCHOR_EVERY) {
    const from = users[anchor]
    if (from >= turnStart) break
    if (size(messages.slice(from, turnStart)) + turnRoom(budgetChars) > budgetChars) continue
    const said: ModelMessage[] = []
    for (const message of messages.slice(0, from)) {
      if (message.role === 'user') said.push(message)
      else if (message.role === 'assistant') {
        const text = parts(message).filter((part) => part.type === 'text' || (keepReasoning && part.type === 'reasoning'))
        if (text.some((part) => part.type === 'text')) said.push(withParts(message, text))
      }
    }
    return [{ role: 'user', content: COMPACTED_NOTE }, ...said, ...messages.slice(from)]
  }
  return null
}

// When even the pruned history is too long, drop the tool traffic of the oldest turns and keep what was said.
// An assistant message and the tool messages that answer it go together, so a call is never left without its result.
function fitBudget(messages: ModelMessage[], turnStart: number, budgetChars: number, keepReasoning: boolean): ModelMessage[] {
  if (size(messages) <= budgetChars) return messages
  const kept = [...messages]
  let dropped = false
  let index = 0
  while (index < turnStart && size(kept) > budgetChars) {
    const message = kept[index]
    if (message.role === 'tool') {
      kept.splice(index, 1)
      turnStart -= 1
      dropped = true
      continue
    }
    if (message.role === 'assistant') {
      let end = index + 1
      while (end < turnStart && kept[end].role === 'tool') end += 1
      const text = parts(message).filter((part) => part.type === 'text' || (keepReasoning && part.type === 'reasoning'))
      if (end > index + 1 || text.length < parts(message).length) dropped = true
      const replacement = text.some((part) => part.type === 'text') ? [withParts(message, text)] : []
      kept.splice(index, end - index, ...replacement)
      turnStart -= end - index - replacement.length
      index += replacement.length
      continue
    }
    index += 1
  }
  return dropped ? [{ role: 'user', content: COMPACTED_NOTE }, ...kept] : kept
}

function hasWords(message: ModelMessage): boolean {
  if (typeof message.content === 'string') return message.content.trim().length > 0
  return parts(message).some((part) => (part.type === 'text' && String(part.text ?? '').trim().length > 0) || part.type === 'tool-call' || part.type === 'file' || part.type === 'image')
}

/**
 * The last check before a request: every tool result follows the assistant message that made the call, every
 * call has its result, and no assistant message is empty. A provider answers 400 to anything else, and the same
 * history would fail on every retry, so a chat could never go on.
 */
export function repairHistory(messages: ModelMessage[]): ModelMessage[] {
  const repaired: ModelMessage[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'tool') continue
    if (message.role !== 'assistant') {
      repaired.push(message)
      continue
    }
    let end = index + 1
    const answers: ModelMessage[] = []
    while (end < messages.length && messages[end].role === 'tool') {
      answers.push(messages[end])
      end += 1
    }
    const answered = new Set(answers.flatMap((answer) => parts(answer)).filter((part) => part.type === 'tool-result').map((part) => String(part.toolCallId)))
    const content = Array.isArray(message.content) ? parts(message).filter((part) => part.type !== 'tool-call' || answered.has(String(part.toolCallId))) : null
    const assistant = content ? withParts(message, content) : message
    if (hasWords(assistant)) {
      repaired.push(assistant)
      const called = new Set(parts(assistant).filter((part) => part.type === 'tool-call').map((part) => String(part.toolCallId)))
      const results = answers.flatMap((answer) => parts(answer)).filter((part) => part.type === 'tool-result' && called.has(String(part.toolCallId)))
      if (results.length > 0) repaired.push({ role: 'tool', content: results } as unknown as ModelMessage)
    }
    index = end - 1
  }
  return repaired
}

/** A reply that holds nothing (a request that failed leaves one) must not be stored or sent again. */
export function withoutEmptyReplies<T extends { role: string; parts: { type: string; text?: string }[] }>(messages: T[]): T[] {
  return messages.filter(
    (message) => message.role !== 'assistant' || message.parts.some((part) => (part.type === 'text' && (part.text ?? '').trim().length > 0) || part.type.startsWith('tool-') || part.type === 'dynamic-tool' || part.type === 'file'),
  )
}
