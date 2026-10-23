import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { NextResponse } from 'next/server'
import { rewritePreviewUrls } from './site-route'

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript',
  '.ics': 'text/calendar; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
}

const previewText = new Set(['.html', '.css', '.svg', '.js'])

// Text that gets smaller when it is compressed. Pictures and fonts are compressed already.
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.xml', '.txt', '.svg', '.ics', '.webmanifest'])
const SMALLEST = 600

type Encoding = 'br' | 'gzip'

/** The encoding a visitor's browser accepts, the better one first; null when it accepts neither. */
export function chooseEncoding(accept: string | null): Encoding | null {
  const q = new Map<string, number>()
  for (const part of (accept ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    if (!name) continue
    const weight = Number(params.map((param) => param.trim()).find((param) => param.startsWith('q='))?.slice(2) ?? 1)
    q.set(name, Number.isNaN(weight) ? 1 : weight)
  }
  const wants = (name: string) => (q.get(name) ?? q.get('*') ?? 0) > 0
  if (wants('br')) return 'br'
  if (wants('gzip') || wants('x-gzip')) return 'gzip'
  return null
}

// A compressed file is kept until the file changes, so a page is compressed once and not for every visitor.
const compressed = new Map<string, Buffer>()
let compressedBytes = 0

function compress(key: string, raw: Buffer, encoding: Encoding): Buffer {
  const found = compressed.get(key)
  if (found) return found
  const made = encoding === 'br' ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }) : zlib.gzipSync(raw, { level: 9 })
  if (compressedBytes + made.length > 64_000_000) {
    compressed.clear()
    compressedBytes = 0
  }
  compressed.set(key, made)
  compressedBytes += made.length
  return made
}

/** How long a browser may keep a file without asking. A page and a stylesheet are asked about every time (cheap, with the validator); a picture or a font changes rarely. */
function cacheControl(rel: string, ext: string): string {
  if (ext === '.woff2' || ext === '.woff') return 'public, max-age=604800'
  if (/^media\/.+\.(?:jpe?g|png|webp|gif|avif|svg)$/i.test(rel.replace(/^\/+/, ''))) return 'public, max-age=86400'
  return 'no-cache'
}

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

export function serveGenerated(root: string, rel: string, preview: boolean, request?: Request): Response {
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
  const ext = path.extname(file)
  const type = path.basename(file) === 'feed.xml' ? 'application/atom+xml; charset=utf-8' : (types[ext] ?? 'application/octet-stream')
  if (preview) {
    const raw = fs.readFileSync(file)
    const body = previewText.has(ext) ? Buffer.from(rewritePreviewUrls(raw.toString('utf8'))) : raw
    return new NextResponse(body, { headers: { 'content-type': type, 'cache-control': 'no-cache' } })
  }
  const stat = fs.statSync(file)
  const version = `${Math.round(stat.mtimeMs)}-${stat.size}`
  const raw = fs.readFileSync(file)
  const encoding = COMPRESSIBLE.has(ext) && raw.length >= SMALLEST ? chooseEncoding(request?.headers.get('accept-encoding') ?? null) : null
  const etag = `${encoding ? 'W/' : ''}"${version}${encoding ? `-${encoding}` : ''}"`
  const headers: Record<string, string> = {
    'content-type': type,
    'cache-control': cacheControl(path.relative(root, file).split(path.sep).join('/'), ext),
    etag,
    ...(COMPRESSIBLE.has(ext) ? { vary: 'Accept-Encoding' } : {}),
  }
  if (request?.headers.get('if-none-match')?.split(',').some((tag) => tag.trim() === etag)) return new NextResponse(null, { status: 304, headers })
  const body = encoding ? compress(`${file}|${version}|${encoding}`, raw, encoding) : raw
  return new NextResponse(new Uint8Array(body), { headers: { ...headers, ...(encoding ? { 'content-encoding': encoding } : {}), 'content-length': String(body.length) } })
}

export function unpublishedHtml(): string {
  return '<!doctype html><meta charset="utf-8"><title>Not published</title><p>This site has not been published.</p>'
}
