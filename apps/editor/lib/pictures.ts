import fs from 'node:fs'
import path from 'node:path'
import { readYaml, writeYaml } from '@schlor/generator'

export const PICTURE_BYTE_LIMIT = 8_000_000

export type PictureKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'svg'

export type PictureRecord = {
  file: string
  address: string
  description: string
  tags: string[]
  usages: number
}

type CatalogEntry = { file: string; description?: string; tags?: string[] }

const EXTENSIONS: Record<PictureKind, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  svg: 'svg',
}

const FILE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'])

export function detectPicture(bytes: Uint8Array): PictureKind | null {
  if (bytes.byteLength > PICTURE_BYTE_LIMIT) return null
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }
  return looksLikeSvg(bytes) ? 'svg' : null
}

export function stemFromFilename(filename: string): string {
  const base = path.posix.basename(filename.replaceAll('\\', '/')).replace(/\.[^.]+$/, '')
  const stem = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return stem || 'picture'
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const clean = tag.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= 24) break
  }
  return out
}

export function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ').slice(0, 400)
}

export function listPictures(root: string): PictureRecord[] {
  const files = pictureFiles(root)
  const known = new Set(files)
  const counts = usageCounts(root, known)
  const catalog = catalogByFile(root)
  return files.map((file) => toRecord(file, catalog.get(file), counts.get(file) ?? 0))
}

export function searchPictures(root: string, query: string, limit = 30): { total: number; matched: number; matches: PictureRecord[] } {
  const pictures = listPictures(root)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = words.length
    ? pictures.filter((picture) => {
        const haystack = `${picture.file} ${picture.description} ${picture.tags.join(' ')}`.toLowerCase()
        return words.every((word) => haystack.includes(word))
      })
    : []
  return { total: pictures.length, matched: matches.length, matches: matches.slice(0, limit) }
}

export function storePicture(
  root: string,
  input: { bytes: Uint8Array; filename: string; description?: string; tags?: string[]; replace?: boolean },
): PictureRecord {
  const kind = detectPicture(input.bytes)
  if (!kind) throw new Error('That file is not a JPEG, PNG, WebP, GIF, or SVG.')
  const media = mediaDir(root)
  fs.mkdirSync(media, { recursive: true })
  const stem = stemFromFilename(input.filename)
  const ext = EXTENSIONS[kind]
  const file = freeFile(media, '', stem, ext, input.replace === true)
  fs.writeFileSync(path.join(media, file), input.bytes)
  const description = normalizeDescription(input.description ?? '')
  const tags = normalizeTags(input.tags ?? [])
  remember(root, file, description, tags)
  return toRecord(file, { description, tags }, countUsages(root, file))
}

export function updatePicture(
  root: string,
  file: string,
  input: { name: string; description: string; tags: string[] },
): PictureRecord {
  const current = assertPictureFile(root, file)
  const description = normalizeDescription(input.description)
  const tags = normalizeTags(input.tags)
  const stem = stemFromFilename(input.name)
  const ext = path.posix.extname(current.file).slice(1) || 'jpg'
  const dir = path.posix.dirname(current.file)
  const next = path.posix.join(dir === '.' ? '' : dir, `${stem}.${ext}`)
  if (next !== current.file) {
    const dest = path.join(mediaDir(root), next)
    if (fs.existsSync(dest)) throw new Error('That name is already used.')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.renameSync(current.full, dest)
  }
  remember(root, next, description, tags, current.file)
  return toRecord(next, { description, tags }, countUsages(root, next))
}

export function readPicture(root: string, file: string): PictureRecord {
  const current = assertPictureFile(root, picturePath(file))
  return toRecord(current.file, catalogByFile(root).get(current.file), countUsages(root, current.file))
}

export function discardPicture(root: string, file: string): void {
  const current = assertPictureFile(root, picturePath(file))
  fs.rmSync(current.full, { force: true })
  const catalog = readCatalog(root).filter((entry) => entry.file !== current.file)
  writeCatalog(root, catalog)
}

function picturePath(file: string): string {
  const normalized = file.trim().replaceAll('\\', '/')
  return normalized.startsWith('/media/') ? normalized.slice('/media/'.length) : normalized.replace(/^\/+/, '')
}

export function readPictureBytes(root: string, file: string): { bytes: Uint8Array; mediaType: string } {
  const current = assertPictureFile(root, file)
  const ext = path.posix.extname(current.file).toLowerCase()
  const mediaType =
    ext === '.svg'
      ? 'image/svg+xml'
      : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : 'image/jpeg'
  return { bytes: fs.readFileSync(current.full), mediaType }
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 2000)).trimStart().toLowerCase()
  if (!head.includes('<svg') || head.includes('<html') || head.includes('<!doctype html')) return false
  return head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!doctype svg') || head.startsWith('<!--')
}

function mediaDir(root: string): string {
  return path.join(root, 'media')
}

function catalogPath(root: string): string {
  return path.join(mediaDir(root), 'pictures.yml')
}

function pictureFiles(root: string): string[] {
  const media = mediaDir(root)
  if (!fs.existsSync(media)) return []
  const found: string[] = []
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'pictures.yml') continue
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, nextRel)
      else if (entry.isFile() && FILE_EXTENSIONS.has(path.posix.extname(entry.name).toLowerCase())) found.push(nextRel)
    }
  }
  walk(media, '')
  return found.sort((a, b) => a.localeCompare(b))
}

function freeFile(media: string, dir: string, stem: string, ext: string, replace: boolean): string {
  const candidate = path.posix.join(dir, `${stem}.${ext}`)
  if (!fs.existsSync(path.join(media, candidate)) || replace) return candidate
  for (let n = 2; n < 1000; n++) {
    const next = path.posix.join(dir, `${stem}-${n}.${ext}`)
    if (!fs.existsSync(path.join(media, next))) return next
  }
  throw new Error('Could not find a free picture name.')
}

function assertPictureFile(root: string, file: string): { file: string; full: string } {
  const normalized = file.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '')) throw new Error('Unknown picture.')
  const media = mediaDir(root)
  const full = path.resolve(media, normalized)
  const rel = path.relative(media, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Unknown picture.')
  const stored = rel.split(path.sep).join('/')
  if (!FILE_EXTENSIONS.has(path.posix.extname(stored).toLowerCase())) throw new Error('Unknown picture.')
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error('Unknown picture.')
  return { file: stored, full }
}

function readCatalog(root: string): CatalogEntry[] {
  const parsed = readYaml<CatalogEntry[]>(catalogPath(root), [])
  return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.file === 'string') : []
}

function writeCatalog(root: string, entries: CatalogEntry[]): void {
  const kept = entries
    .map((entry) => ({
      file: entry.file,
      description: normalizeDescription(entry.description ?? ''),
      tags: normalizeTags(entry.tags ?? []),
    }))
    .filter((entry) => entry.description || entry.tags.length > 0)
    .sort((a, b) => a.file.localeCompare(b.file))
  if (kept.length === 0) {
    fs.rmSync(catalogPath(root), { force: true })
    return
  }
  writeYaml(catalogPath(root), kept)
}

function catalogByFile(root: string): Map<string, { description: string; tags: string[] }> {
  const map = new Map<string, { description: string; tags: string[] }>()
  for (const entry of readCatalog(root)) {
    map.set(entry.file, { description: normalizeDescription(entry.description ?? ''), tags: normalizeTags(entry.tags ?? []) })
  }
  return map
}

function remember(root: string, file: string, description: string, tags: string[], previous = file): void {
  const catalog = readCatalog(root).filter((entry) => entry.file !== previous && entry.file !== file)
  catalog.push({ file, description, tags })
  writeCatalog(root, catalog)
}

function toRecord(file: string, meta: { description: string; tags: string[] } | undefined, usages: number): PictureRecord {
  return {
    file,
    address: `/media/${file}`,
    description: meta?.description ?? '',
    tags: meta?.tags ?? [],
    usages,
  }
}

function usageCounts(root: string, files: Set<string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const text of contentTexts(root)) {
    for (const match of text.matchAll(/\/media\/[^\s"'<>)]+/g)) {
      const rel = match[0].slice('/media/'.length).replace(/[.,;:]+$/, '')
      if (!files.has(rel)) continue
      counts.set(rel, (counts.get(rel) ?? 0) + 1)
    }
  }
  return counts
}

function countUsages(root: string, file: string): number {
  const address = `/media/${file}`
  let count = 0
  for (const text of contentTexts(root)) count += countAddress(text, address)
  return count
}

function countAddress(text: string, address: string): number {
  let count = 0
  let from = 0
  while (from < text.length) {
    const at = text.indexOf(address, from)
    if (at < 0) break
    const next = text[at + address.length] ?? ''
    if (!/[A-Za-z0-9._~+-]/.test(next)) count += 1
    from = at + address.length
  }
  return count
}

function contentTexts(root: string): string[] {
  const content = path.join(root, 'content')
  if (!fs.existsSync(content)) return []
  const texts: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && /\.(md|ya?ml)$/i.test(entry.name)) texts.push(fs.readFileSync(full, 'utf8'))
    }
  }
  walk(content)
  return texts
}
