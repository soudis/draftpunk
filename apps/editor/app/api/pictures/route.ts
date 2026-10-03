import { commitAll } from '@/lib/git'
import { discardPicture, listPictures, storePicture, updatePicture } from '@/lib/pictures'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  return Response.json({ pictures: listPictures(siteRoot()) })
}

export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'Choose a picture.' }, { status: 400 })
  try {
    const saved = storePicture(siteRoot(), {
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name || 'picture',
    })
    commitAll(siteRoot(), `Save picture ${saved.file}`, { name: session.name, email: session.email })
    return Response.json(saved, { status: 201 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not save that picture.' }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const body = (await request.json()) as { file?: string; name?: string; description?: string; tags?: string[] }
  if (!body.file) return Response.json({ error: 'Unknown picture.' }, { status: 404 })
  try {
    const saved = updatePicture(siteRoot(), body.file, {
      name: body.name ?? body.file,
      description: body.description ?? '',
      tags: body.tags ?? [],
    })
    commitAll(siteRoot(), `Update picture ${saved.file}`, { name: session.name, email: session.email })
    return Response.json(saved)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update that picture.'
    return Response.json({ error: message }, { status: message === 'Unknown picture.' ? 404 : 400 })
  }
}

export async function DELETE(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const body = (await request.json()) as { file?: string }
  if (!body.file) return Response.json({ error: 'Unknown picture.' }, { status: 404 })
  try {
    discardPicture(siteRoot(), body.file)
    commitAll(siteRoot(), `Discard picture ${body.file}`, { name: session.name, email: session.email })
    return Response.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not discard that picture.'
    return Response.json({ error: message }, { status: message === 'Unknown picture.' ? 404 : 400 })
  }
}
