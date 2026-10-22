import { normalizeModelBase } from './model-catalog'

export type Thinking = 'default' | 'off'

const DEEPSEEK = 'https://api.deepseek.com'
const ZAI = 'https://api.z.ai/api/paas/v4'
const OPENAI = 'https://api.openai.com/v1'

/** What a provider needs in the request to answer without a long chain of thought. Unknown providers get nothing. */
export function thinkingParams(baseURL: string, model: string, thinking: Thinking): Record<string, unknown> {
  if (thinking !== 'off') return {}
  const base = normalizeModelBase(baseURL)
  if (base === normalizeModelBase(DEEPSEEK) || base === normalizeModelBase(ZAI)) return { thinking: { type: 'disabled' } }
  if (base === normalizeModelBase(OPENAI) && /^gpt-(5|6)/.test(model.trim().toLowerCase())) return { reasoning_effort: 'minimal' }
  return {}
}

/**
 * DeepSeek in thinking mode wants the chain of thought of every earlier assistant message back in a request that
 * carries tools, even a message that called no tool, and answers 400 without it.
 */
export function needsReasoningPassBack(baseURL: string): boolean {
  return normalizeModelBase(baseURL) === normalizeModelBase(DEEPSEEK)
}

type ChatBody = {
  tools?: unknown
  messages?: { role?: string; reasoning_content?: unknown; [key: string]: unknown }[]
  [key: string]: unknown
}

/** The request body as this provider and this kind of request need it. */
export function shapeRequestBody<T extends ChatBody>(body: T, context: { baseURL: string; model: string; thinking: Thinking }): T {
  const extra = thinkingParams(context.baseURL, context.model, context.thinking)
  const shaped: ChatBody = { ...body, ...extra }
  if (context.thinking === 'default' && needsReasoningPassBack(context.baseURL) && Array.isArray(shaped.tools) && shaped.tools.length > 0 && shaped.messages) {
    shaped.messages = shaped.messages.map((message) =>
      message.role === 'assistant' && typeof message.reasoning_content !== 'string' ? { ...message, reasoning_content: '' } : message,
    )
  }
  return shaped as T
}

/**
 * How much one answer may be, for providers that cap it low by default and allow a lot. A proposal or a page
 * of layouts is long, and an answer that is cut off in the middle of its arguments cannot be used.
 */
export function outputLimit(baseURL: string): number | undefined {
  const base = normalizeModelBase(baseURL)
  return base === normalizeModelBase(DEEPSEEK) || base === normalizeModelBase(ZAI) ? 32_768 : undefined
}
