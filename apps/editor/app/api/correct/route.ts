import { applyContentCorrection, generate } from '@schlor/generator'
import { commitPath } from '@/lib/git'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  let body: { hint?: unknown; old?: unknown; next?: unknown }
  try {
    body = (await request.json()) as { hint?: unknown; old?: unknown; next?: unknown }
  } catch {
    return Response.json({ error: 'That hint is not a content field.' }, { status: 400 })
  }
  if (typeof body.hint !== 'string' || typeof body.old !== 'string' || typeof body.next !== 'string') {
    return Response.json({ error: 'That hint is not a content field.' }, { status: 400 })
  }
  const root = siteRoot()
  const result = applyContentCorrection(root, body.hint, body.old, body.next)
  if ('error' in result) return Response.json({ error: result.error }, { status: 400 })
  if (!result.changed) return Response.json({ ok: true })
  try {
    generate(root)
    commitPath(root, result.file, `Corrected text in ${result.file}`, { name: session.name, email: session.email })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'That text could not be corrected.'
    return Response.json({ error: message }, { status: 400 })
  }
  return Response.json({ ok: true })
}
