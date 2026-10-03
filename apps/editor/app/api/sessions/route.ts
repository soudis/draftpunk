import { sessionFromRequest } from '@/lib/session'
import { chatsFor, startChat } from '@/lib/sessions'
import type { EditorMode } from '@/lib/mode'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  return Response.json(chatsFor(session.sub))
}

export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { mode?: string }
  const mode = body.mode === 'design' || body.mode === 'setup' ? body.mode : 'content'
  return Response.json(startChat(session.sub, mode), { status: 201 })
}
