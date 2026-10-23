import crypto from 'node:crypto'
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

/**
 * How long a browser may keep a file without asking. A page is asked about every time (cheap, with the validator).
 * A stylesheet named by its content and a smaller copy of a picture never change under their name, and fonts hardly do.
 */
function cacheControl(rel: string, ext: string): string {
  const clean = rel.replace(/^\/+/, '')
  if (/^assets\/styles\.[0-9a-f]{10}\.css$/.test(clean) || clean.startsWith('media/_sizes/')) return 'public, max-age=31536000, immutable'
  if (ext === '.woff2' || ext === '.woff') return 'public, max-age=604800'
  if (/^media\/.+\.(?:jpe?g|png|webp|gif|avif|svg)$/i.test(clean)) return 'public, max-age=86400'
  return 'no-cache'
}

/** What an SVG file may do when it is opened directly: draw itself, with its own styles and embedded pictures. */
const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"

// Sent with every file of the public site.
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
}

/**
 * What a page may load: only its own site (nothing from another host, which the design rules already guarantee),
 * and scripts only when they are in a file of the site or are the very scripts the page carries (named by their hash).
 */
export function contentSecurityPolicy(html: string): string {
  const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((script) => !/\bsrc\s*=/i.test(script[1]) && !/\btype\s*=\s*["']?application\/(?:ld\+)?json/i.test(script[1]))
    .map((script) => `'sha256-${crypto.createHash('sha256').update(script[2]).digest('base64')}'`)
  return [
    "default-src 'self'",
    `script-src 'self' ${[...new Set(hashes)].join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; ')
}

/** The file an address is, and whether it is a folder's index page (an address without its closing slash). */
export function matchSiteFile(root: string, rel: string): { file: string; viaIndex: boolean } | undefined {
  const direct = path.join(root, rel)
  const escaped = path.relative(root, direct)
  if (escaped.startsWith('..') || path.isAbsolute(escaped)) return undefined
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return { file: direct, viaIndex: false }
  const index = path.join(direct, 'index.html')
  const indexEscaped = path.relative(root, index)
  if (indexEscaped.startsWith('..') || path.isAbsolute(indexEscaped)) return undefined
  if (fs.existsSync(index) && fs.statSync(index).isFile()) return { file: index, viaIndex: true }
  return undefined
}

export function resolveSiteFile(root: string, rel: string): string | undefined {
  return matchSiteFile(root, rel)?.file
}

/** The page for an address that is not there: the nearest 404.html up the folders (so /en/ has its own), else a plain line. */
function notFound(root: string, rel: string, request?: Request): Response {
  if (path.extname(rel) && path.extname(rel) !== '.html') return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' } })
  const folders = rel.split('/').filter(Boolean).slice(0, -1)
  for (let depth = folders.length; depth >= 0; depth -= 1) {
    const candidate = path.join(root, ...folders.slice(0, depth), '404.html')
    if (fs.existsSync(candidate)) return respond(root, candidate, request, 404)
  }
  return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' } })
}

function respond(root: string, file: string, request: Request | undefined, status = 200): Response {
  const ext = path.extname(file)
  const type = path.basename(file) === 'feed.xml' ? 'application/atom+xml; charset=utf-8' : (types[ext] ?? 'application/octet-stream')
  const stat = fs.statSync(file)
  const version = `${Math.round(stat.mtimeMs)}-${stat.size}`
  const raw = fs.readFileSync(file)
  const encoding = COMPRESSIBLE.has(ext) && raw.length >= SMALLEST ? chooseEncoding(request?.headers.get('accept-encoding') ?? null) : null
  const etag = `${encoding ? 'W/' : ''}"${version}${encoding ? `-${encoding}` : ''}"`
  const headers: Record<string, string> = {
    'content-type': type,
    'cache-control': status === 200 ? cacheControl(path.relative(root, file).split(path.sep).join('/'), ext) : 'no-cache',
    ...SECURITY_HEADERS,
    ...(ext === '.html' ? { 'content-security-policy': contentSecurityPolicy(raw.toString('utf8')) } : {}),
    // An SVG opened on its own is a page of the site's address: nothing in it may run or load.
    ...(ext === '.svg' ? { 'content-security-policy': SVG_POLICY } : {}),
    ...(status === 200 ? { etag } : {}),
    ...(COMPRESSIBLE.has(ext) ? { vary: 'Accept-Encoding' } : {}),
  }
  if (status === 200 && request?.headers.get('if-none-match')?.split(',').some((tag) => tag.trim() === etag)) return new NextResponse(null, { status: 304, headers })
  const body = encoding ? compress(`${file}|${version}|${encoding}`, raw, encoding) : raw
  return new NextResponse(new Uint8Array(body), { status, headers: { ...headers, ...(encoding ? { 'content-encoding': encoding } : {}), 'content-length': String(body.length) } })
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
  const found = matchSiteFile(root, rel)
  if (preview) {
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const ext = path.extname(found.file)
    const type = path.basename(found.file) === 'feed.xml' ? 'application/atom+xml; charset=utf-8' : (types[ext] ?? 'application/octet-stream')
    const raw = fs.readFileSync(found.file)
    const body = previewText.has(ext) ? Buffer.from(rewritePreviewUrls(raw.toString('utf8'))) : raw
    return new NextResponse(body, { headers: { 'content-type': type, 'cache-control': 'no-cache', ...(ext === '.svg' ? { 'content-security-policy': SVG_POLICY } : {}) } })
  }
  if (!found) return notFound(root, rel, request)
  // A page has one address, the one with the closing slash: /kontakt goes to /kontakt/.
  if (found.viaIndex && rel !== '' && !rel.endsWith('/')) {
    const search = request ? new URL(request.url).search : ''
    return new NextResponse(null, { status: 308, headers: { location: `/${rel}/${search}`, 'cache-control': 'public, max-age=3600' } })
  }
  return respond(root, found.file, request)
}

export function unpublishedHtml(): string {
  return '<!doctype html><meta charset="utf-8"><title>Not published</title><p>This site has not been published.</p>'
}
