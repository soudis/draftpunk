import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { currentModelSettings } from './model-settings'
import { stemFromFilename, type PictureKind } from './pictures'

export type PictureSuggestion = { name: string; description: string; tags: string[] }

export function parseSuggestion(text: string): PictureSuggestion {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { name: '', description: '', tags: [] }
  try {
    const parsed = JSON.parse(match[0]) as { name?: unknown; description?: unknown; tags?: unknown }
    const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : []
    return {
      name: typeof parsed.name === 'string' ? stemFromFilename(parsed.name) : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      tags,
    }
  } catch {
    return { name: '', description: '', tags: [] }
  }
}

export async function suggestPicture(bytes: Uint8Array, kind: PictureKind, hint = ''): Promise<PictureSuggestion> {
  const modelSettings = currentModelSettings()
  if (!modelSettings.apiKey) throw new Error('LLM_API_KEY is not set')
  const provider = createOpenAICompatible({
    name: 'editor',
    baseURL: modelSettings.baseURL,
    apiKey: modelSettings.apiKey,
  })
  const instruction = [
    'Look at this picture and reply with JSON only:',
    '{"name":"short-readable-words","description":"one German sentence for finding it later","tags":["word"]}',
    'name is lowercase words with hyphens and no extension.',
    'description is German. It is for finding the picture, and it is not shown on the website.',
    'tags are a few short words.',
    hint ? `The current filename hint is ${hint}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const image =
    kind === 'svg'
      ? null
      : { type: 'image' as const, image: bytes, mediaType: mediaType(kind) }
  const svgText = kind === 'svg' ? new TextDecoder().decode(bytes.subarray(0, 8000)) : ''
  const result = await generateText({
    model: provider.chatModel(modelSettings.model),
    messages: [
      {
        role: 'user',
        content: image
          ? [{ type: 'text', text: instruction }, image]
          : [{ type: 'text', text: `${instruction}\n\n${svgText}` }],
      },
    ],
  })
  return parseSuggestion(result.text)
}

function mediaType(kind: Exclude<PictureKind, 'svg'>): string {
  if (kind === 'png') return 'image/png'
  if (kind === 'webp') return 'image/webp'
  if (kind === 'gif') return 'image/gif'
  return 'image/jpeg'
}
