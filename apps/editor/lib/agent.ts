import { stepCountIs, type ModelMessage, type ToolSet } from 'ai'
import { browserConfigured } from './browser'
import { pruneHistory } from './history'
import type { EditorMode } from './mode'
import { systemPrompt } from './prompt'
import { screenshotIds, ScreenshotStore } from './screenshots'
import { toolsFor } from './tools'
import { createVerifier } from './verify'

export const STEP_LIMIT = 40

type ToolCallInput = { type: 'tool-call'; toolCallId: string; toolName: string; input: string; providerExecuted?: boolean }

/**
 * Models sometimes send tool arguments as code-fenced JSON or as a JSON string that holds JSON.
 * Repair those without asking the model again. Anything else goes back to the model as an error.
 */
export function repairToolInput(toolCall: ToolCallInput): ToolCallInput | null {
  let text = toolCall.input.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text)
  if (fenced) text = fenced[1]
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start === -1 || end <= start || attempt > 0) return null
      text = text.slice(start, end + 1)
      continue
    }
    if (typeof parsed === 'string') {
      text = parsed
      continue
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...toolCall, input: JSON.stringify(parsed) }
    return null
  }
  return null
}

/**
 * A tool result can only carry text to the model. A picture from preview_page is put in front of it
 * as a user message for the next step, and is gone from the step after that.
 */
export function attachScreenshots(messages: ModelMessage[], store: ScreenshotStore): ModelMessage[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'tool') return messages
  const ids = (last.content as { type: string; toolName?: string; output?: unknown }[])
    .filter((part) => part.type === 'tool-result' && part.toolName === 'preview_page')
    .flatMap((part) => screenshotIds(JSON.stringify(part.output ?? '')))
  const pictures = ids.flatMap((id) => {
    const found = store.get(id)
    return found ? [{ type: 'image' as const, image: found.data, mediaType: found.mediaType }] : []
  })
  if (pictures.length === 0) return messages
  return [...messages, { role: 'user', content: [{ type: 'text', text: 'The picture from preview_page:' }, ...pictures] }]
}

export type AgentRun = {
  system: string
  tools: ToolSet
  stopWhen: ReturnType<typeof stepCountIs>
  prepareStep: (options: { stepNumber: number; messages: ModelMessage[] }) => { messages: ModelMessage[]; toolChoice?: 'none' }
  experimental_repairToolCall: (options: { toolCall: ToolCallInput; error: unknown }) => Promise<ToolCallInput | null>
}

/** The settings the chat route and the eval runner both give to streamText. */
export function agentRun(mode: EditorMode, root: string, options: { vision?: boolean } = {}): AgentRun {
  const screenshots = new ScreenshotStore()
  return {
    system: systemPrompt(mode, root, new Date(), { browser: browserConfigured(), vision: options.vision }),
    tools: toolsFor(mode, root, { vision: options.vision, screenshots, verifier: createVerifier() }),
    stopWhen: stepCountIs(STEP_LIMIT),
    prepareStep: ({ stepNumber, messages }) => ({
      messages: attachScreenshots(pruneHistory(messages), screenshots),
      ...(stepNumber >= STEP_LIMIT - 1 ? { toolChoice: 'none' as const } : {}),
    }),
    experimental_repairToolCall: async ({ toolCall, error }) => {
      const name = (error as { name?: string } | undefined)?.name
      if (name === 'AI_NoSuchToolError') return null
      return repairToolInput(toolCall)
    },
  }
}
