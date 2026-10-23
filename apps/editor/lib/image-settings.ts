import fs from 'node:fs'
import path from 'node:path'
import { normalizeModelBase } from './model-catalog'
import { currentModelSettings } from './model-settings'
import { chatDatabasePath } from './site'

/** The kinds of image service the editor can talk to. Each has its own request shape. */
export const IMAGE_KINDS = ['openai', 'google', 'bfl', 'runware'] as const
export type ImageKind = (typeof IMAGE_KINDS)[number]

export type ImageProvider = { kind: ImageKind; name: string; baseURL: string; modelHint: string }

export const IMAGE_PROVIDERS: ImageProvider[] = [
  { kind: 'openai', name: 'OpenAI-style (OpenAI, Together, …)', baseURL: 'https://api.openai.com/v1', modelHint: 'gpt-image-1' },
  { kind: 'google', name: 'Google (Gemini image, Imagen)', baseURL: 'https://generativelanguage.googleapis.com/v1beta', modelHint: 'gemini-2.5-flash-image' },
  { kind: 'bfl', name: 'FLUX (Black Forest Labs)', baseURL: 'https://api.bfl.ai/v1', modelHint: 'flux-pro-1.1' },
  { kind: 'runware', name: 'Runware', baseURL: 'https://api.runware.ai/v1', modelHint: 'the AIR id from the model page, such as provider:model@1' },
]

export function providerOf(kind: string): ImageProvider | undefined {
  return IMAGE_PROVIDERS.find((provider) => provider.kind === kind)
}

export type StoredImageSettings = { provider: ImageKind | ''; baseURL: string; model: string; apiKey: string }

export type ResolvedImageSettings = StoredImageSettings & {
  /** Everything needed to make a picture is set. */
  configured: boolean
}

export type ImageEnv = { IMAGE_PROVIDER?: string; IMAGE_BASE_URL?: string; IMAGE_MODEL?: string; IMAGE_API_KEY?: string }

export function imageSettingsPath(): string {
  return path.join(path.dirname(chatDatabasePath()), 'image.json')
}

const EMPTY: StoredImageSettings = { provider: '', baseURL: '', model: '', apiKey: '' }

export function readStoredImageSettings(file: string): StoredImageSettings {
  if (!fs.existsSync(file)) return { ...EMPTY }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    const provider = typeof parsed.provider === 'string' && providerOf(parsed.provider) ? (parsed.provider as ImageKind) : ''
    return {
      provider,
      baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    }
  } catch {
    return { ...EMPTY }
  }
}

export function writeStoredImageSettings(file: string, stored: StoredImageSettings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(stored)}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

/**
 * What the editor will use: the saved settings, else the environment. A Runware key may stand in for the image key
 * when the chat model is also Runware, so one key serves both.
 */
export function resolveImageSettings(
  stored: StoredImageSettings,
  env: ImageEnv = { IMAGE_PROVIDER: process.env.IMAGE_PROVIDER, IMAGE_BASE_URL: process.env.IMAGE_BASE_URL, IMAGE_MODEL: process.env.IMAGE_MODEL, IMAGE_API_KEY: process.env.IMAGE_API_KEY },
  chat: { baseURL: string; apiKey: string } = { baseURL: '', apiKey: '' },
): ResolvedImageSettings {
  const fromEnv = env.IMAGE_PROVIDER?.trim() ?? ''
  const provider = stored.provider || (providerOf(fromEnv) ? (fromEnv as ImageKind) : '')
  const baseURL = stored.baseURL.trim() || env.IMAGE_BASE_URL?.trim() || (provider ? (providerOf(provider)?.baseURL ?? '') : '')
  const model = stored.model.trim() || env.IMAGE_MODEL?.trim() || ''
  const sharesChatKey = provider === 'runware' && normalizeModelBase(chat.baseURL) === normalizeModelBase(providerOf('runware')?.baseURL ?? '')
  const apiKey = stored.apiKey.trim() || env.IMAGE_API_KEY?.trim() || (sharesChatKey ? chat.apiKey.trim() : '')
  return { provider, baseURL, model, apiKey, configured: Boolean(provider && baseURL && model && apiKey) }
}

export function assertImageAddress(baseURL: string): void {
  if (!baseURL.trim()) return
  let url: URL
  try {
    url = new URL(baseURL.trim())
  } catch {
    throw new Error('The image service address must be an http URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The image service address must be an http URL.')
}

/** A new setting wins; a blank key keeps the saved one. Choosing no service clears the choice and keeps the key. */
export function applyImageSettingsUpdate(stored: StoredImageSettings, input: { provider: string; baseURL: string; model: string; apiKey: string }): StoredImageSettings {
  const provider = providerOf(input.provider) ? (input.provider as ImageKind) : ''
  return { provider, baseURL: input.baseURL.trim(), model: input.model.trim(), apiKey: input.apiKey.trim() || stored.apiKey.trim() }
}

/** The settings in force now: saved ones, then the environment, then the chat key for Runware. */
export function currentImageSettings(): ResolvedImageSettings {
  const chat = currentModelSettings()
  return resolveImageSettings(readStoredImageSettings(imageSettingsPath()), undefined, { baseURL: chat.baseURL, apiKey: chat.apiKey })
}
