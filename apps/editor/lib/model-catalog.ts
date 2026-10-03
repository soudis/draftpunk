export type ModelProvider = {
  name: string
  baseURL: string
  models: string[]
}

export const MODEL_PROVIDERS: ModelProvider[] = [
  {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: [
      'gpt-6-astra',
      'gpt-6.1-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.2',
      'gpt-5.1',
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'gpt-4o',
      'gpt-4o-mini',
    ],
  },
  {
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
  },
  {
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    models: [
      'claude-fable-5-1',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-4-5',
      'claude-fable-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-5',
      'claude-sonnet-4-6',
    ],
  },
  {
    name: 'Z.AI',
    baseURL: 'https://api.z.ai/api/paas/v4',
    models: [
      'glm-5.3',
      'glm-5.3-flash',
      'glm-5.3-flashx',
      'glm-5.2',
      'glm-5.1',
      'glm-5',
      'glm-4.7',
      'glm-4.7-flashx',
      'glm-4.7-flash',
      'glm-4.6',
      'glm-4.6v',
      'glm-4.6v-flashx',
      'glm-4.6v-flash',
      'glm-4.5',
      'glm-4.5v',
      'glm-4.5-x',
      'glm-4.5-air',
      'glm-4.5-airx',
      'glm-4.5-flash',
      'glm-4-32b-0414-128k',
    ],
  },
  {
    name: 'Kimi',
    baseURL: 'https://api.moonshot.ai/v1',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6'],
  },
  {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
]

export type ModelChoice = {
  provider: string
  baseURL: string
  model: string
}

export function normalizeModelBase(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

export function providerForBase(baseURL: string): ModelProvider | undefined {
  const key = normalizeModelBase(baseURL)
  return MODEL_PROVIDERS.find((provider) => normalizeModelBase(provider.baseURL) === key)
}

export function addressSuggestions(query: string): ModelProvider[] {
  const trimmed = query.trim()
  const folded = trimmed.toLowerCase()
  if (!folded || providerForBase(trimmed)) return MODEL_PROVIDERS
  return MODEL_PROVIDERS.filter(
    (provider) => provider.name.toLowerCase().includes(folded) || provider.baseURL.toLowerCase().includes(folded),
  )
}

export function modelSuggestions(query: string, baseURL: string): ModelChoice[] {
  const choices = MODEL_PROVIDERS.flatMap((provider) =>
    provider.models.map((model) => ({ provider: provider.name, baseURL: provider.baseURL, model })),
  )
  const trimmed = query.trim()
  const folded = trimmed.toLowerCase()
  const exact = choices.some((choice) => choice.model === trimmed)
  const matched =
    !folded || exact
      ? choices
      : choices.filter(
          (choice) => choice.model.toLowerCase().includes(folded) || choice.provider.toLowerCase().includes(folded),
        )
  const current = providerForBase(baseURL)
  if (!current) return matched
  return [
    ...matched.filter((choice) => choice.provider === current.name),
    ...matched.filter((choice) => choice.provider !== current.name),
  ]
}

export function modelAfterProviderPick(currentModel: string, provider: ModelProvider): string {
  const trimmed = currentModel.trim()
  if (provider.models.includes(trimmed)) return trimmed
  return provider.models[0] ?? trimmed
}
