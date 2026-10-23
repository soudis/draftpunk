import { generate } from '@schlor/generator'
import { commitDetail, fileDiff, listHistory, restoreDraft, restoreFile, restorePreview, undoChange, type HistoryResult } from '@/lib/history-log'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

function failure(error: unknown, fallback: string) {
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 })
}

/** The changes of the draft, newest first; one change with its files; or the lines it made to one file. */
export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const url = new URL(request.url)
  const root = siteRoot()
  try {
    const revision = url.searchParams.get('revision')
    const file = url.searchParams.get('file')
    if (revision && file) return Response.json(fileDiff(root, revision, file))
    if (revision) return Response.json(commitDetail(root, revision))
    return Response.json(listHistory(root, Number(url.searchParams.get('skip') ?? 0) || 0, Number(url.searchParams.get('limit') ?? 50) || 50))
  } catch (error) {
    return failure(error, 'Could not read the history')
  }
}

/** Restore the draft or one file, or undo one change. Restore and undo become new changes, so nothing is lost. */
export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  let body: { action?: unknown; revision?: unknown; file?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: 'Unknown history action' }, { status: 400 })
  }
  const root = siteRoot()
  const author = { name: session.name, email: session.email }
  try {
    let result: HistoryResult
    if (body.action === 'preview') {
      const file = typeof body.file === 'string' ? body.file : undefined
      return Response.json({ sentences: restorePreview(root, String(body.revision ?? ''), file) })
    }
    if (body.action === 'restore') result = restoreDraft(root, String(body.revision ?? ''), author)
    else if (body.action === 'restoreFile') result = restoreFile(root, String(body.revision ?? ''), String(body.file ?? ''), author)
    else if (body.action === 'undo') result = undoChange(root, String(body.revision ?? ''), author)
    else return Response.json({ error: 'Unknown history action' }, { status: 400 })
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
    generate(root)
    return Response.json({ ok: true, revision: result.revision })
  } catch (error) {
    return failure(error, 'The draft could not be changed')
  }
}
