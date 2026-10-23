import {
  applyImageSettingsUpdate,
  assertImageAddress,
  IMAGE_PROVIDERS,
  imageSettingsPath,
  providerOf,
  readStoredImageSettings,
  resolveImageSettings,
  writeStoredImageSettings,
} from '@/lib/image-settings'
import { currentModelSettings } from '@/lib/model-settings'
import { sessionFromRequest } from '@/lib/session'

export const runtime = 'nodejs'

function view() {
  const chat = currentModelSettings()
  const resolved = resolveImageSettings(readStoredImageSettings(imageSettingsPath()), undefined, { baseURL: chat.baseURL, apiKey: chat.apiKey })
  return {
    provider: resolved.provider,
    baseURL: resolved.baseURL,
    model: resolved.model,
    keySet: resolved.apiKey.length > 0,
    configured: resolved.configured,
    providers: IMAGE_PROVIDERS.map(({ kind, name, baseURL, modelHint }) => ({ kind, name, baseURL, modelHint })),
  }
}

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  return Response.json(view())
}

export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const body = (await request.json()) as { provider?: unknown; baseURL?: unknown; model?: unknown; apiKey?: unknown }
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const provider = text(body.provider)
  if (provider && !providerOf(provider)) return Response.json({ error: 'Choose one of the image services in the list.' }, { status: 400 })
  try {
    assertImageAddress(text(body.baseURL))
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'The image service address must be an http URL.' }, { status: 400 })
  }
  const file = imageSettingsPath()
  const next = applyImageSettingsUpdate(readStoredImageSettings(file), { provider, baseURL: text(body.baseURL), model: text(body.model), apiKey: text(body.apiKey) })
  if (next.provider) {
    if (!next.model) return Response.json({ error: 'Enter the name of the image model.' }, { status: 400 })
    const chat = currentModelSettings()
    if (!resolveImageSettings(next, undefined, { baseURL: chat.baseURL, apiKey: chat.apiKey }).apiKey) return Response.json({ error: 'Enter a token for the image service.' }, { status: 400 })
  }
  writeStoredImageSettings(file, next)
  return Response.json(view())
}
