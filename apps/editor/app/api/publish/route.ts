import { publishChanges } from '@/lib/changes'
import { publishSite } from '@/lib/publish'
import { openSession, sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  try {
    return Response.json({ changes: publishChanges(siteRoot()) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not list changes'
    return Response.json({ error: message }, { status: 400 })
  }
}

export async function POST(request: Request) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)schlor_editor=([^;]+)/)?.[1]
  const session = await openSession(token ? decodeURIComponent(token) : undefined)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  try {
    const result = publishSite(siteRoot(), { name: session.name, email: session.email }, 'Publish the draft')
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed'
    return Response.json({ error: message }, { status: 400 })
  }
}
