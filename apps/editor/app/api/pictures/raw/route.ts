import path from 'node:path'
import { pictureThumbnail, readPictureBytes } from '@/lib/pictures'
import { sessionFromRequest } from '@/lib/session'
import { chatDatabasePath, siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const url = new URL(request.url)
  const file = url.searchParams.get('file') ?? ''
  const width = Number(url.searchParams.get('w') ?? 0)
  try {
    const picture =
      width > 0
        ? await pictureThumbnail(siteRoot(), file, width, path.join(path.dirname(chatDatabasePath()), 'thumbs'))
        : { ...readPictureBytes(siteRoot(), file), version: '' }
    const etag = picture.version ? `"${picture.version}-${width}"` : undefined
    const headers: Record<string, string> = {
      'content-type': picture.mediaType,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      // A picture changes only when its file does; the browser asks again whether it still fits.
      'cache-control': 'private, max-age=0, must-revalidate',
      ...(etag ? { etag } : {}),
    }
    if (etag && request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
    const body = picture.bytes.buffer.slice(picture.bytes.byteOffset, picture.bytes.byteOffset + picture.bytes.byteLength) as ArrayBuffer
    return new Response(body, { headers })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unknown picture.' }, { status: 404 })
  }
}
