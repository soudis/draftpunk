import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { rewritePreviewUrls } from './site-route'

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

const previewText = new Set(['.html', '.css', '.svg', '.js'])

export function resolveSiteFile(root: string, rel: string): string | undefined {
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

export function serveGenerated(root: string, rel: string, preview: boolean): Response {
  if (rel.includes('..')) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const published = fs.existsSync(path.join(root, 'index.html'))
  if (!published && !preview) {
    if (path.extname(rel) && path.extname(rel) !== '.html') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return new NextResponse(unpublishedHtml(), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    })
  }
  const file = resolveSiteFile(root, rel)
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const raw = fs.readFileSync(file)
  const ext = path.extname(file)
  const body = preview && previewText.has(ext) ? Buffer.from(rewritePreviewUrls(raw.toString('utf8'))) : raw
  return new NextResponse(body, {
    headers: { 'content-type': types[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' },
  })
}

export function unpublishedHtml(): string {
  return '<!doctype html><meta charset="utf-8"><title>Not published</title><p>This site has not been published.</p>'
}
