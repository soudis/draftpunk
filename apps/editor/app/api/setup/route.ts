import { setupAccepted } from '@schlor/generator'
import { sessionFromRequest } from '@/lib/session'
import { skipSetup } from '@/lib/setup-start'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  return Response.json({ accepted: setupAccepted(siteRoot()) })
}

export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { action?: string }
  if (body.action !== 'skip') return Response.json({ error: 'Unknown action' }, { status: 400 })
  try {
    return Response.json(skipSetup(siteRoot(), { name: session.name, email: session.email }))
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Setup could not be skipped.' }, { status: 400 })
  }
}
