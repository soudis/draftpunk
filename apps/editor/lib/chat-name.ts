import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { currentModelSettings } from './model-settings'

export function cleanChatName(text: string): string {
  const line = text.trim().split('\n')[0]?.replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ').trim() ?? ''
  const bounded = line.length > 48 ? line.slice(0, 48).replace(/\s+\S*$/, '').trim() : line
  return bounded.replace(/[.,;:]+$/, '') || 'New chat'
}

export function fallbackChatName(input: string): string {
  const sentence = input.trim().split(/(?<=[.!?])\s/)[0] ?? input
  return cleanChatName(sentence)
}

export async function nameFromFirstInput(input: string): Promise<string> {
  const fallback = fallbackChatName(input)
  const modelSettings = currentModelSettings()
  if (!modelSettings.apiKey || !input.trim()) return fallback
  try {
    const provider = createOpenAICompatible({
      name: 'editor',
      baseURL: modelSettings.baseURL,
      apiKey: modelSettings.apiKey,
    })
    const result = await generateText({
      model: provider.chatModel(modelSettings.model),
      prompt: [
        'Name this chat from the first message.',
        'Reply with a short name only, in the language of the message, at most six words, with no quotes.',
        '',
        input.trim().slice(0, 2000),
      ].join('\n'),
    })
    const name = cleanChatName(result.text)
    return name === 'New chat' ? fallback : name
  } catch (error) {
    console.error(error)
    return fallback
  }
}
