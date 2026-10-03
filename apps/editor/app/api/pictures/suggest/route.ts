import { suggestPicture } from '@/lib/picture-vision'
import { detectPicture, readPictureBytes, stemFromFilename } from '@/lib/pictures'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const body = (await request.json()) as { file?: string }
  if (!body.file) return Response.json({ error: 'Unknown picture.' }, { status: 404 })
  try {
    const picture = readPictureBytes(siteRoot(), body.file)
    const kind = detectPicture(picture.bytes)
    if (!kind) return Response.json({ error: 'That file is not a JPEG, PNG, WebP, GIF, or SVG.' }, { status: 400 })
    const suggestion = await suggestPicture(picture.bytes, kind, stemFromFilename(body.file))
    return Response.json(suggestion)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not look at that picture.'
    return Response.json({ error: message }, { status: message === 'Unknown picture.' ? 404 : 502 })
  }
}
