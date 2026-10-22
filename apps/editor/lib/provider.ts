import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { wrapLanguageModel } from 'ai'
import { leakedCallMiddleware } from './leaked-calls'
import { attachThoughtSignatures, tapThoughtSignatures } from './gemini'
import { shapeRequestBody } from './thinking'
import type { RequestPlan } from './routing'

/** The model of a request, with what its provider needs in the request: thinking off or on, and what Gemini and DeepSeek want sent back. */
export function modelFor(settings: { baseURL: string; apiKey: string }, plan: RequestPlan) {
  const thoughtSignatures = new Map<string, string>()
  const provider = createOpenAICompatible({
    name: 'editor',
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    fetch: async (input, init) => tapThoughtSignatures(await fetch(input, init), thoughtSignatures),
    transformRequestBody: (body) =>
      attachThoughtSignatures(shapeRequestBody(body as never, { baseURL: settings.baseURL, model: plan.model, thinking: plan.thinking }), thoughtSignatures),
  })
  return wrapLanguageModel({ model: provider.chatModel(plan.model), middleware: leakedCallMiddleware() })
}
