import { generate } from '@schlor/generator'
import { revertDraft, undoReply } from '@/lib/draft'
import { isAncestor } from '@/lib/git'
import { clearReplyCommit, editorDatabase, replyCommits } from '@/lib/sessions'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const database = editorDatabase()
  const undos = replyCommits(database).filter((row) => {
    if (isAncestor(siteRoot(), row.revision)) return true
    clearReplyCommit(database, row.messageId)
    return false
  })
  return Response.json({ undos: undos.map((row) => ({ sessionId: row.sessionId, messageId: row.messageId })) })
}

export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const body = (await request.json()) as { action?: string; messageId?: string }
  const root = siteRoot()
  try {
    if (body.action === 'undo') {
      const result = undoReply(root, { name: session.name, email: session.email }, String(body.messageId ?? ''))
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
