import { sessionFromRequest } from '@/lib/session'
import { chatFor, removeChat, storeChatMode } from '@/lib/sessions'
import type { EditorMode } from '@/lib/mode'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const { id } = await context.params
  const chat = chatFor(session.sub, id)
  if (!chat) return Response.json({ error: 'Chat not found' }, { status: 404 })
  return Response.json(chat)
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const { id } = await context.params
  const body = (await request.json()) as { mode?: string }
  const mode: EditorMode = body.mode === 'design' || body.mode === 'setup' ? body.mode : 'content'
  if (!storeChatMode(session.sub, id, mode)) return Response.json({ error: 'Chat not found' }, { status: 404 })
  return Response.json({ id, mode })
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const { id } = await context.params
  const result = removeChat(session.sub, id)
  if (!result) return Response.json({ error: 'Chat not found' }, { status: 404 })
  return Response.json(result)
}
