import path from 'node:path'
import { generate, readYaml, writeYaml } from '@schlor/generator'
import { commitPath } from '@/lib/git'
import {
  applyModelSettingsUpdate,
  assertModelBase,
  modelSettingsPath,
  readStoredModelSettings,
  resolveModelSettings,
  writeStoredModelSettings,
} from '@/lib/model-settings'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

function siteFile(root: string): string {
  return path.join(root, 'design', 'site.yml')
}

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const resolved = resolveModelSettings(readStoredModelSettings(modelSettingsPath()))
  const site = readYaml<{ name?: string }>(siteFile(siteRoot()), {})
  return Response.json({
    baseURL: resolved.baseURL,
    model: resolved.model,
    tokenSet: resolved.apiKey.length > 0,
    siteName: String(site.name ?? '').trim(),
  })
}

export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const body = (await request.json()) as { baseURL?: unknown; model?: unknown; apiKey?: unknown; siteName?: unknown }
  const siteName = typeof body.siteName === 'string' ? body.siteName.trim() : ''
  if (!siteName) return Response.json({ error: 'Enter a site name.' }, { status: 400 })
  const baseURL = typeof body.baseURL === 'string' ? body.baseURL : ''
  const model = typeof body.model === 'string' ? body.model : ''
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
  try {
    assertModelBase(baseURL)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The model address must be an http URL.'
    return Response.json({ error: message }, { status: 400 })
  }
  const file = modelSettingsPath()
  const stored = readStoredModelSettings(file)
  const next = applyModelSettingsUpdate(stored, { baseURL, model, apiKey })
  const resolved = resolveModelSettings(next)
  if (!resolved.apiKey) return Response.json({ error: 'Enter a token.' }, { status: 400 })
  writeStoredModelSettings(file, next)
  const root = siteRoot()
  const site = readYaml<Record<string, unknown>>(siteFile(root), {})
  const previous = String(site.name ?? '').trim()
  if (previous !== siteName) {
    site.name = siteName
    writeYaml(siteFile(root), site)
    generate(root)
    commitPath(root, 'design/site.yml', `Set the site name to ${siteName}`, {
      name: session.name,
      email: session.email,
    })
  }
  return Response.json({
    baseURL: resolved.baseURL,
    model: resolved.model,
    tokenSet: true,
    siteName,
  })
}
