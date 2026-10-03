import { generate } from '@schlor/generator'
import { revertDraft, undoLastReply } from '@/lib/draft'
import { isAncestor } from '@/lib/git'
import { clearReplyCommit, editorDatabase, replyCommit } from '@/lib/sessions'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const database = editorDatabase()
  const row = replyCommit(database)
  if (!row) return Response.json({ undo: null })
  if (!isAncestor(siteRoot(), row.revision)) {
    clearReplyCommit(database)
    return Response.json({ undo: null })
  }
  return Response.json({ undo: { sessionId: row.sessionId, messageId: row.messageId } })
}

export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const body = (await request.json()) as { action?: string }
  const root = siteRoot()
  try {
    if (body.action === 'undo') {
      const result = undoLastReply(root, { name: session.name, email: session.email })
      if (!result.undone) return Response.json({ error: result.error }, { status: 400 })
      generate(root)
      return Response.json({ ok: true })
    }
    if (body.action === 'revert') {
      const result = revertDraft(root)
      if (!result.reverted) return Response.json({ error: result.error }, { status: 400 })
      generate(root)
      return Response.json({ ok: true })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The draft could not be changed'
    return Response.json({ error: message }, { status: 400 })
  }
  return Response.json({ error: 'Unknown draft action' }, { status: 400 })
}
