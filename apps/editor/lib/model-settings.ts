import fs from 'node:fs'
import path from 'node:path'
import { modelSupportsVision } from './model-catalog'
import { chatDatabasePath } from './site'

export const DEFAULT_MODEL_BASE = 'https://api.openai.com/v1'
export const DEFAULT_MODEL_NAME = 'gpt-4.1'

export type StoredModelSettings = {
  baseURL: string
  model: string
  apiKey: string
  /** A cheaper model for plain text edits. Same address and token. */
  contentModel?: string
}

export type ResolvedModelSettings = {
  baseURL: string
  model: string
  apiKey: string
  /** The model reads pictures, so it may be shown a screenshot. */
  vision: boolean
  /** A cheaper model for plain text edits, or empty. */
  contentModel: string
  /** auto: no thinking for plain text edits. off: never. default: the model decides. */
  thinking: 'auto' | 'off' | 'default'
}

export type ModelEnv = {
  LLM_BASE_URL?: string
  LLM_MODEL?: string
  LLM_API_KEY?: string
  LLM_VISION?: string
  LLM_CONTENT_MODEL?: string
  LLM_THINKING?: string
}

export function modelSettingsPath(): string {
  return path.join(path.dirname(chatDatabasePath()), 'model.json')
}

export function readStoredModelSettings(file: string): StoredModelSettings {
  if (!fs.existsSync(file)) return { baseURL: '', model: '', apiKey: '', contentModel: '' }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      baseURL?: unknown
      model?: unknown
      apiKey?: unknown
      contentModel?: unknown
    }
    return {
      baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      contentModel: typeof parsed.contentModel === 'string' ? parsed.contentModel : '',
    }
  } catch {
    return { baseURL: '', model: '', apiKey: '', contentModel: '' }
  }
}

export function resolveModelSettings(
  stored: StoredModelSettings,
  env: ModelEnv = {
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_VISION: process.env.LLM_VISION,
    LLM_CONTENT_MODEL: process.env.LLM_CONTENT_MODEL,
    LLM_THINKING: process.env.LLM_THINKING,
  },
): ResolvedModelSettings {
  const baseURL = stored.baseURL.trim() || env.LLM_BASE_URL?.trim() || DEFAULT_MODEL_BASE
  const model = stored.model.trim() || env.LLM_MODEL?.trim() || DEFAULT_MODEL_NAME
  const content = stored.contentModel?.trim() || env.LLM_CONTENT_MODEL?.trim() || ''
  return {
    baseURL,
    model,
    apiKey: stored.apiKey.trim() || env.LLM_API_KEY?.trim() || '',
    vision: modelSupportsVision(baseURL, model, env.LLM_VISION),
    contentModel: content === model ? '' : content,
    thinking: env.LLM_THINKING === 'off' ? 'off' : env.LLM_THINKING === 'default' ? 'default' : 'auto',
  }
}

export function applyModelSettingsUpdate(
  stored: StoredModelSettings,
  input: { baseURL: string; model: string; apiKey: string; contentModel?: string },
): StoredModelSettings {
  return {
    baseURL: input.baseURL.trim(),
    model: input.model.trim(),
    apiKey: input.apiKey.trim() || stored.apiKey.trim(),
    contentModel: input.contentModel === undefined ? (stored.contentModel ?? '') : input.contentModel.trim(),
  }
}

export function assertModelBase(baseURL: string): void {
  if (!baseURL.trim()) return
  let url: URL
  try {
    url = new URL(baseURL.trim())
  } catch {
    throw new Error('The model address must be an http URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The model address must be an http URL.')
  }
}

export function currentModelSettings(): ResolvedModelSettings {
  return resolveModelSettings(readStoredModelSettings(modelSettingsPath()))
}

export function writeStoredModelSettings(file: string, stored: StoredModelSettings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(stored)}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}
