import { stepCountIs, type ModelMessage, type ToolSet } from 'ai'
import { pruneHistory } from './history'
import type { EditorMode } from './mode'
import { systemPrompt } from './prompt'
import { toolsFor } from './tools'

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

export type AgentRun = {
  system: string
  tools: ToolSet
  stopWhen: ReturnType<typeof stepCountIs>
  prepareStep: (options: { stepNumber: number; messages: ModelMessage[] }) => { messages: ModelMessage[]; toolChoice?: 'none' }
  experimental_repairToolCall: (options: { toolCall: ToolCallInput; error: unknown }) => Promise<ToolCallInput | null>
}

/** The settings the chat route and the eval runner both give to streamText. */
export function agentRun(mode: EditorMode, root: string): AgentRun {
  return {
    system: systemPrompt(mode, root),
    tools: toolsFor(mode, root),
    stopWhen: stepCountIs(STEP_LIMIT),
    prepareStep: ({ stepNumber, messages }) => ({
      messages: pruneHistory(messages),
      ...(stepNumber >= STEP_LIMIT - 1 ? { toolChoice: 'none' as const } : {}),
    }),
    experimental_repairToolCall: async ({ toolCall, error }) => {
      const name = (error as { name?: string } | undefined)?.name
      if (name === 'AI_NoSuchToolError') return null
      return repairToolInput(toolCall)
    },
  }
}
