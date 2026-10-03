import fs from 'node:fs'
import path from 'node:path'
import { chatDatabasePath } from './site'

export const DEFAULT_MODEL_BASE = 'https://api.openai.com/v1'
export const DEFAULT_MODEL_NAME = 'gpt-4.1'

export type StoredModelSettings = {
  baseURL: string
  model: string
  apiKey: string
}

export type ResolvedModelSettings = {
  baseURL: string
  model: string
  apiKey: string
}

export type ModelEnv = {
  LLM_BASE_URL?: string
  LLM_MODEL?: string
  LLM_API_KEY?: string
}

export function modelSettingsPath(): string {
  return path.join(path.dirname(chatDatabasePath()), 'model.json')
}

export function readStoredModelSettings(file: string): StoredModelSettings {
  if (!fs.existsSync(file)) return { baseURL: '', model: '', apiKey: '' }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      baseURL?: unknown
      model?: unknown
      apiKey?: unknown
    }
    return {
      baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    }
  } catch {
    return { baseURL: '', model: '', apiKey: '' }
  }
}

export function resolveModelSettings(
  stored: StoredModelSettings,
  env: ModelEnv = {
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_API_KEY: process.env.LLM_API_KEY,
  },
): ResolvedModelSettings {
  return {
    baseURL: stored.baseURL.trim() || env.LLM_BASE_URL?.trim() || DEFAULT_MODEL_BASE,
    model: stored.model.trim() || env.LLM_MODEL?.trim() || DEFAULT_MODEL_NAME,
    apiKey: stored.apiKey.trim() || env.LLM_API_KEY?.trim() || '',
  }
}

export function applyModelSettingsUpdate(
  stored: StoredModelSettings,
  input: { baseURL: string; model: string; apiKey: string },
): StoredModelSettings {
  return {
    baseURL: input.baseURL.trim(),
    model: input.model.trim(),
    apiKey: input.apiKey.trim() || stored.apiKey.trim(),
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
