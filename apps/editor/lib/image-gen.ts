import { fetchPublicBytes } from './read-website'
import type { Resolve } from './safe-fetch'
import type { FetchPage } from './web-render'
import type { ResolvedImageSettings } from './image-settings'

/**
 * New pictures from an image service. Four kinds of service speak four ways; each is one function here that turns
 * a prompt and a shape into the bytes of a picture. The shape is an aspect ratio, and a width in CSS pixels when the
 * service takes pixels. A service that does not gets its nearest size, and the result says what was made.
 */
export const ASPECTS = ['square', 'landscape', 'wide', 'portrait', 'tall'] as const
export type Aspect = (typeof ASPECTS)[number]

export const RATIOS: Record<Aspect, [number, number]> = { square: [1, 1], landscape: [3, 2], wide: [16, 9], portrait: [2, 3], tall: [9, 16] }

export type ImageRequest = { prompt: string; aspect: Aspect; width?: number }
export type MadeImage = { bytes: Uint8Array; service: string; size: string }

export type ImageDeps = {
  /** For the service's own calls. */
  fetchApi?: typeof fetch
  /** For a picture a service gives as an address: only public hosts. */
  fetchPage?: FetchPage
  /** How a host name is looked up, for the check that it is public. */
  resolve?: Resolve
  /** The pause between asking a job whether it is done. */
  pollMs?: number
  /** The time a job may take. */
  waitMs?: number
}

/** Whole pixels for an aspect: the width asked for (or 1024 on the long side), kept inside what the service takes, in the service's steps. */
export function pixels(aspect: Aspect, width: number | undefined, limits: { step: number; min: number; max: number }): { width: number; height: number } {
  const [rw, rh] = RATIOS[aspect]
  const wide = rw >= rh
  let w = width && width > 0 ? width : wide ? 1024 : Math.round((1024 * rw) / rh)
  let h = (w * rh) / rw
  const longest = Math.max(w, h)
  const shortest = Math.min(w, h)
  if (longest > limits.max) {
    w = (w * limits.max) / longest
    h = (h * limits.max) / longest
  } else if (shortest < limits.min) {
    w = (w * limits.min) / shortest
    h = (h * limits.min) / shortest
  }
  const snap = (value: number) => Math.min(limits.max, Math.max(limits.min, Math.round(value / limits.step) * limits.step))
  return { width: snap(w), height: snap(h) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The sentence a service gave for its refusal, whatever shape it came in. */
export function serviceError(name: string, status: number, text: string): Error {
  let message = text.trim().slice(0, 300)
  try {
    const body = JSON.parse(text) as Record<string, unknown>
    const error = body.error as Record<string, unknown> | string | undefined
    const errors = body.errors as { message?: string }[] | undefined
    message = String((typeof error === 'object' ? error?.message : error) ?? errors?.[0]?.message ?? body.message ?? body.detail ?? message).slice(0, 300)
  } catch {
    // not JSON: the start of the text will do
  }
  const refused = status === 401 || status === 403 ? ' The key was refused: check it in the settings.' : ''
  return new Error(`${name} answered ${status}: ${message}${refused}`)
}

async function call(name: string, deps: ImageDeps, url: string, init: RequestInit): Promise<unknown> {
  const response = await (deps.fetchApi ?? fetch)(url, { ...init, signal: AbortSignal.timeout(deps.waitMs ?? 120_000) })
  const text = await response.text()
  if (!response.ok) throw serviceError(name, response.status, text)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${name} did not answer with JSON: ${text.slice(0, 120)}`)
  }
}

const fromBase64 = (data: string) => new Uint8Array(Buffer.from(data, 'base64'))

async function download(url: string, deps: ImageDeps): Promise<Uint8Array> {
  return (await fetchPublicBytes(url, deps.fetchPage, deps.resolve)).body
}

async function openaiStyle(settings: ResolvedImageSettings, request: ImageRequest, deps: ImageDeps): Promise<MadeImage> {
  const official = /(^|\.)openai\.com$/i.test(new URL(settings.baseURL).hostname)
  const model = settings.model.toLowerCase()
  const [rw, rh] = RATIOS[request.aspect]
  let size: string
  let extra: Record<string, number> = {}
  if (official || model.startsWith('gpt-image') || model.startsWith('dall-e')) {
    const sizes = model.startsWith('dall-e-3') ? ['1024x1024', '1792x1024', '1024x1792'] : model.startsWith('dall-e') ? ['1024x1024', '1024x1024', '1024x1024'] : ['1024x1024', '1536x1024', '1024x1536']
    size = rw === rh ? sizes[0] : rw > rh ? sizes[1] : sizes[2]
  } else {
    const found = pixels(request.aspect, request.width, { step: 16, min: 256, max: 1536 })
    size = `${found.width}x${found.height}`
    extra = { width: found.width, height: found.height }
  }
  const body = (await call('The image service', deps, `${settings.baseURL.replace(/\/+$/, '')}/images/generations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model: settings.model, prompt: request.prompt, n: 1, size, ...extra }),
  })) as { data?: { b64_json?: string; url?: string }[] }
  const item = body.data?.[0]
  if (item?.b64_json) return { bytes: fromBase64(item.b64_json), service: `${settings.model}`, size }
  if (item?.url) return { bytes: await download(item.url, deps), service: `${settings.model}`, size }
  throw new Error('The image service answered without a picture.')
}

const GOOGLE_ASPECTS: Record<Aspect, string> = { square: '1:1', landscape: '3:2', wide: '16:9', portrait: '2:3', tall: '9:16' }
// Imagen takes only these ratios; the nearest is used.
const IMAGEN_ASPECTS: Record<Aspect, string> = { square: '1:1', landscape: '4:3', wide: '16:9', portrait: '3:4', tall: '9:16' }

async function google(settings: ResolvedImageSettings, request: ImageRequest, deps: ImageDeps): Promise<MadeImage> {
  const base = settings.baseURL.replace(/\/+$/, '')
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': settings.apiKey }
  if (/^imagen-/i.test(settings.model)) {
    const aspectRatio = IMAGEN_ASPECTS[request.aspect]
    const body = (await call('Google', deps, `${base}/models/${settings.model}:predict`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ instances: [{ prompt: request.prompt }], parameters: { sampleCount: 1, aspectRatio } }),
    })) as { predictions?: { bytesBase64Encoded?: string }[] }
    const data = body.predictions?.[0]?.bytesBase64Encoded
    if (!data) throw new Error('Google answered without a picture. The prompt may have been refused.')
    return { bytes: fromBase64(data), service: settings.model, size: aspectRatio }
  }
  const aspectRatio = GOOGLE_ASPECTS[request.aspect]
  const body = (await call('Google', deps, `${base}/models/${settings.model}:generateContent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contents: [{ parts: [{ text: request.prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } } }),
  })) as { candidates?: { content?: { parts?: { inlineData?: { data?: string }; thought?: boolean }[] } }[]; promptFeedback?: { blockReason?: string } }
  const parts = (body.candidates?.[0]?.content?.parts ?? []).filter((part) => !part.thought && part.inlineData?.data)
  const data = parts[parts.length - 1]?.inlineData?.data
  if (!data) throw new Error(`Google answered without a picture.${body.promptFeedback?.blockReason ? ` The prompt was blocked: ${body.promptFeedback.blockReason}.` : ' The prompt may have been refused.'}`)
  return { bytes: fromBase64(data), service: settings.model, size: aspectRatio }
}

async function bfl(settings: ResolvedImageSettings, request: ImageRequest, deps: ImageDeps): Promise<MadeImage> {
  const found = pixels(request.aspect, request.width, { step: 32, min: 256, max: 1440 })
  const headers = { 'content-type': 'application/json', 'x-key': settings.apiKey }
  const started = (await call('Black Forest Labs', deps, `${settings.baseURL.replace(/\/+$/, '')}/${settings.model}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: request.prompt, width: found.width, height: found.height }),
  })) as { id?: string; polling_url?: string }
  const polling = started.polling_url ?? (started.id ? `${settings.baseURL.replace(/\/+$/, '')}/get_result?id=${encodeURIComponent(started.id)}` : '')
  if (!polling) throw new Error('Black Forest Labs did not start a job.')
  const until = Date.now() + (deps.waitMs ?? 120_000)
  while (Date.now() < until) {
    await sleep(deps.pollMs ?? 1000)
    const state = (await call('Black Forest Labs', deps, polling, { headers: { 'x-key': settings.apiKey } })) as { status?: string; result?: { sample?: string }; details?: unknown }
    if (state.status === 'Ready' && state.result?.sample) return { bytes: await download(state.result.sample, deps), service: settings.model, size: `${found.width}x${found.height}` }
    if (state.status && !['Pending', 'Queued', 'Processing', 'Task not found'].includes(state.status) && state.status !== 'Ready') {
      throw new Error(`Black Forest Labs stopped the job: ${state.status}${state.details ? ` (${JSON.stringify(state.details).slice(0, 160)})` : ''}.`)
    }
  }
  throw new Error('The picture was not ready in time. Try again.')
}

async function runware(settings: ResolvedImageSettings, request: ImageRequest, deps: ImageDeps): Promise<MadeImage> {
  const found = pixels(request.aspect, request.width, { step: 64, min: 128, max: 2048 })
  const taskUUID = crypto.randomUUID()
  const body = (await call('Runware', deps, settings.baseURL.replace(/\/+$/, ''), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify([{ taskType: 'imageInference', taskUUID, model: settings.model, positivePrompt: request.prompt, width: found.width, height: found.height, numberResults: 1 }]),
  })) as { data?: { taskUUID?: string; imageURL?: string; imageBase64Data?: string }[]; errors?: { message?: string }[]; error?: { message?: string } | string }
  if (!body.data?.length) {
    const reason = body.errors?.[0]?.message ?? (typeof body.error === 'object' ? body.error?.message : body.error)
    throw new Error(`Runware gave no picture${reason ? `: ${reason}` : ''}.`)
  }
  const item = body.data.find((entry) => entry.taskUUID === taskUUID) ?? body.data[0]
  if (item.imageBase64Data) return { bytes: fromBase64(item.imageBase64Data), service: settings.model, size: `${found.width}x${found.height}` }
  if (item.imageURL) return { bytes: await download(item.imageURL, deps), service: settings.model, size: `${found.width}x${found.height}` }
  throw new Error('Runware answered without a picture.')
}

export async function generateImage(settings: ResolvedImageSettings, request: ImageRequest, deps: ImageDeps = {}): Promise<MadeImage> {
  if (!settings.configured || !settings.provider) throw new Error('No image service is set up. Set one in the settings.')
  if (!request.prompt.trim()) throw new Error('prompt is empty.')
  switch (settings.provider) {
    case 'openai':
      return openaiStyle(settings, request, deps)
    case 'google':
      return google(settings, request, deps)
    case 'bfl':
      return bfl(settings, request, deps)
    case 'runware':
      return runware(settings, request, deps)
  }
}
