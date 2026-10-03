import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { openSession } from '@/lib/session'
import { previewDir } from '@/lib/site'

export function resolvePreviewFile(root: string, rel: string): string | undefined {
  const direct = path.join(root, rel)
  const escaped = path.relative(root, direct)
  if (escaped.startsWith('..') || path.isAbsolute(escaped)) return undefined
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct
  const index = path.join(direct, 'index.html')
  const indexEscaped = path.relative(root, index)
  if (indexEscaped.startsWith('..') || path.isAbsolute(indexEscaped)) return undefined
  if (fs.existsSync(index) && fs.statSync(index).isFile()) return index
  return undefined
}

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript',
  '.ics': 'text/calendar; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
}

export async function GET(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const session = await openSession(request.headers.get('cookie')?.match(/(?:^|;\s*)schlor_editor=([^;]+)/)?.[1])
  if (!session) return NextResponse.json({ error: 'Login required' }, { status: 401 })
  const { path: parts = [] } = await context.params
  const rel = parts.join('/')
  if (rel.includes('..')) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const root = previewDir()
  const file = resolvePreviewFile(root, rel)
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = fs.readFileSync(file)
  return new NextResponse(body, {
    headers: { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' },
  })
}
