import { readPictureBytes } from '@/lib/pictures'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const file = new URL(request.url).searchParams.get('file') ?? ''
  try {
    const picture = readPictureBytes(siteRoot(), file)
    const body = picture.bytes.buffer.slice(picture.bytes.byteOffset, picture.bytes.byteOffset + picture.bytes.byteLength) as ArrayBuffer
    return new Response(body, {
      headers: {
        'content-type': picture.mediaType,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unknown picture.' }, { status: 404 })
  }
}
