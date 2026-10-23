import { stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from 'ai'
import { browserConfigured } from './browser'
import { pruneHistory } from './history'
import { isMechanicalStep } from './thinking'
import type { EditorMode } from './mode'
import { systemPrompt } from './prompt'
import { screenshotIds, ScreenshotStore } from './screenshots'
import { toolsFor } from './tools'
import { createVerifier } from './verify'

export const STEP_LIMIT = 40

type ToolCallInput = { type: 'tool-call'; toolCallId: string; toolName: string; input: string; providerExecuted?: boolean }

/** Control characters that a model writes raw inside a JSON string (a new line, a tab) are not valid there. Escape them. */
function escapeControlCharacters(text: string): string {
  let out = ''
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (char === '\\') {
        out += char + (text[index + 1] ?? '')
        index += 1
      } else if (char === '"') {
        inString = false
        out += char
      } else if (char === '\n') out += '\\n'
      else if (char === '\r') out += '\\r'
      else if (char === '\t') out += '\\t'
      else out += char
    } else {
      if (char === '"') inString = true
      out += char
    }
  }
  return out
}

function dropTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])(?=(?:[^"\\]|\\.|"(?:[^"\\]|\\.)*")*$)/g, '$1')
}

/** The marker a tool turns into a short instruction when its arguments could not be read at all. */
export const INVALID_JSON = '__invalid_json'

/**
 * Models sometimes send tool arguments as code-fenced JSON, as a JSON string that holds JSON, with raw new lines
 * inside a string, or with a trailing comma. Repair those, which changes no word. Arguments that are cut off or
 * broken in another way are not guessed at: the tool is told so in a few words instead of echoing them back.
 */
export function repairToolInput(toolCall: ToolCallInput): ToolCallInput | null {
  let text = toolCall.input.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text)
  if (fenced) text = fenced[1]
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidates = [text, dropTrailingCommas(escapeControlCharacters(text))]
    let parsed: unknown
    let ok = false
    for (const candidate of candidates) {
      try {
        parsed = JSON.parse(candidate)
        ok = true
        break
      } catch {
        // Try the next form.
      }
    }
    if (!ok) {
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start === -1 || end <= start || attempt > 0) return { ...toolCall, input: JSON.stringify({ [INVALID_JSON]: true }) }
      text = text.slice(start, end + 1)
      continue
    }
    if (typeof parsed === 'string') {
      text = parsed
      continue
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...toolCall, input: JSON.stringify(parsed) }
    return { ...toolCall, input: JSON.stringify({ [INVALID_JSON]: true }) }
  }
  return { ...toolCall, input: JSON.stringify({ [INVALID_JSON]: true }) }
}

export const SCREENSHOT_TOOLS = new Set(['preview_page', 'look_at_picture', 'edit_picture', 'svg_extract', 'svg_edit', 'write_svg', 'trace_picture', 'render_graphic'])

/**
 * A tool result can only carry text to the model. A picture from preview_page, or from a tool that edits or draws a picture, is put in front of it
 * as a user message for the next step, and is gone from the step after that.
 */
export function attachScreenshots(messages: ModelMessage[], store: ScreenshotStore): ModelMessage[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'tool') return messages
  const parts = (last.content as { type: string; toolName?: string; output?: unknown }[]).filter((part) => part.type === 'tool-result' && SCREENSHOT_TOOLS.has(String(part.toolName)))
  const pictures = parts.flatMap((part) => screenshotIds(JSON.stringify(part.output ?? ''))).flatMap((id) => {
    const found = store.get(id)
    return found ? [{ type: 'image' as const, image: found.data, mediaType: found.mediaType }] : []
  })
  if (pictures.length === 0) return messages
  const names = [...new Set(parts.map((part) => String(part.toolName)))]
  return [...messages, { role: 'user', content: [{ type: 'text', text: `The ${pictures.length === 1 ? 'picture' : 'pictures'} from ${names.join(', ')}:` }, ...pictures] }]
}

export type AgentRun = {
  system: string
  tools: ToolSet
  stopWhen: ReturnType<typeof stepCountIs>
  maxOutputTokens?: number
  prepareStep: (options: { stepNumber: number; messages: ModelMessage[] }) => { messages: ModelMessage[]; toolChoice?: 'none'; model?: LanguageModel }
  experimental_repairToolCall: (options: { toolCall: ToolCallInput; error: unknown }) => Promise<ToolCallInput | null>
}

/** The settings the chat route and the eval runner both give to streamText. */
export type BadCallInfo = { toolName: string; reason: string; raw: string }

export function agentRun(
  mode: EditorMode,
  root: string,
  options: {
    vision?: boolean
    cacheDir?: string
    keepReasoning?: boolean
    maxOutputTokens?: number
    onBadCall?: (call: BadCallInfo) => void
    /** The same model with thinking off, for the steps that only write content. */
    quietModel?: LanguageModel
  } = {},
): AgentRun {
  const screenshots = new ScreenshotStore()
  return {
    system: systemPrompt(mode, root, new Date(), { browser: browserConfigured(), vision: options.vision }),
    tools: toolsFor(mode, root, { vision: options.vision, screenshots, verifier: createVerifier(), cacheDir: options.cacheDir }),
    stopWhen: stepCountIs(STEP_LIMIT),
    maxOutputTokens: options.maxOutputTokens,
    prepareStep: ({ stepNumber, messages }) => ({
      messages: attachScreenshots(pruneHistory(messages, undefined, { keepReasoning: options.keepReasoning }), screenshots),
      ...(options.quietModel && isMechanicalStep(messages) ? { model: options.quietModel } : {}),
      ...(stepNumber >= STEP_LIMIT - 1 ? { toolChoice: 'none' as const } : {}),
    }),
    experimental_repairToolCall: async ({ toolCall, error }) => {
      const name = (error as { name?: string } | undefined)?.name
      if (name === 'AI_NoSuchToolError') {
        options.onBadCall?.({ toolName: toolCall.toolName, reason: 'no such tool', raw: toolCall.input })
        return null
      }
      const repaired = repairToolInput(toolCall)
      if (repaired && INVALID_JSON in (JSON.parse(repaired.input) as Record<string, unknown>)) {
        options.onBadCall?.({ toolName: toolCall.toolName, reason: 'arguments could not be read', raw: toolCall.input })
      }
      return repaired
    },
  }
}
