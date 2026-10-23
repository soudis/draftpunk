import { generate, readSiteConfig } from '@schlor/generator'
import { describeDraftChange } from '@/lib/changes'
import { contentEntries, designTextEntries, putBack, readContentForm, readDesignText, writeContentForm } from '@/lib/content-form'
import { searchContentHits } from '@/lib/content-search'
import { commitPath } from '@/lib/git'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'

function failure(error: unknown, fallback: string, status = 400) {
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status })
}

/** The files to browse, the matches of a search, one file as a form, or a design text to read. */
export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const url = new URL(request.url)
  const root = siteRoot()
  try {
    const file = url.searchParams.get('file')
    if (file) return Response.json({ form: readContentForm(root, file) })
    const design = url.searchParams.get('design')
    if (design) return Response.json({ file: design, text: readDesignText(root, design) })
    const query = url.searchParams.get('q')
    if (query !== null) return Response.json(searchContentHits(root, query))
    return Response.json({ entries: contentEntries(root), design: designTextEntries(root) })
  } catch (error) {
    return failure(error, 'Could not read the content')
  }
}

/** Save one content file from its form. The site is built again and the save is one change of the draft. */
export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  let body: { file?: unknown; values?: unknown; revision?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: 'There is nothing to save.' }, { status: 400 })
  }
  const root = siteRoot()
  const saved = writeContentForm(root, body.file, body.values, body.revision)
  if (!saved.ok) return Response.json({ error: saved.error, stale: saved.stale === true }, { status: saved.stale ? 409 : 400 })
  try {
    generate(root)
    const languages = readSiteConfig(root).languages
    const sentence = describeDraftChange(saved.file, 'M', fs.readFileSync(path.join(root, saved.file), 'utf8'), languages)
    commitPath(root, saved.file, sentence, { name: session.name, email: session.email }, 'edit')
  } catch (error) {
    putBack(root, saved.file, saved.previous)
    return failure(error, 'That could not be saved.')
  }
  return Response.json({ ok: true, form: readContentForm(root, saved.file) })
}
