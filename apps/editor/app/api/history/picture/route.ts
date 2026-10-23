import { pictureAt } from '@/lib/history-log'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

/** A picture as one change left it, or as it was before. Served like any picture of the editor: it may not run or load anything. */
export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const url = new URL(request.url)
  try {
    const side = url.searchParams.get('side') === 'before' ? 'before' : 'after'
    const found = pictureAt(siteRoot(), url.searchParams.get('revision') ?? '', url.searchParams.get('file') ?? '', side)
    if (!found) return new Response(null, { status: 404 })
    const body = found.bytes.buffer.slice(found.bytes.byteOffset, found.bytes.byteOffset + found.bytes.byteLength) as ArrayBuffer
    return new Response(body, {
      headers: {
        'content-type': found.mediaType,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        // A revision never changes, so its picture does not either.
        'cache-control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unknown picture.' }, { status: 404 })
  }
}
