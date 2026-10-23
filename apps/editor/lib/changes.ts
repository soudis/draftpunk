import fs from 'node:fs'
import path from 'node:path'
import { readSiteConfig } from '@schlor/generator'
import { git } from './git'

export type ChangeStatus = 'A' | 'M' | 'D'

const PAGE = /^content\/pages\/(.+)\.yml$/
const EVENT = /^content\/events\/([^/]+)\.yml$/
const PLACE = /^content\/places\/([^/]+)\.yml$/
const LAYOUT = /^design\/layouts\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(?:layout\.yml|template\.njk|style\.css)$/
const PICTURE = /^media\/(.+\.(?:jpe?g|png|webp|gif|svg))$/i

const DESIGN: Record<string, string> = {
  'design/styles.css': 'stylesheet',
  'design/shell.njk': 'shell',
  'design/nav.yml': 'navigation',
  'design/site.yml': 'site name and languages',
  'design/brief.md': 'design brief',
  'design/fields.yml': 'event fields',
  'design/labels.yml': 'labels',
  'design/categories.yml': 'categories',
  'design/setup.yml': 'setup',
  'design/proposal.yml': 'setup proposal',
  'content/home.yml': 'homepage news',
  'content/redirects.yml': 'redirects',
  'media/pictures.yml': 'picture descriptions',
}

export function publishChanges(root: string): string[] {
  const languages = readSiteConfig(root).languages
  const sentences = [
    ...new Set(
      listDraftDiff(root).map((entry) => describeDraftChange(entry.file, entry.status, readChangeSource(root, entry), languages)),
    ),
  ]
  if (sentences.length <= 40) return sentences
  return [...sentences.slice(0, 40), `And ${sentences.length - 40} more changes.`]
}

export function describeDraftChange(
  file: string,
  status: ChangeStatus,
  source: string,
  languages: { id: string; label: string }[],
): string {
  const page = PAGE.exec(file)
  if (page) {
    const slug = page[1].split('/').pop() ?? page[1]
    return `${pageVerb(status)} the page ${localized(source, 'title', languages) ?? slug}`
  }
  const event = EVENT.exec(file)
  if (event) return `${pageVerb(status)} the event ${localized(source, 'title', languages) ?? event[1].replace(/\.yml$/, '')}`
  const place = PLACE.exec(file)
  if (place) return `${pageVerb(status)} the place ${localized(source, 'name', languages) ?? place[1].replace(/\.yml$/, '')}`
  const picture = PICTURE.exec(file)
  if (picture) return `${pageVerb(status)} the picture ${picture[1].split('/').pop()}`
  if (file === 'media/pictures.yml') return `${designVerb(status)} picture descriptions`
  const named = DESIGN[file]
  if (named) return `${designVerb(status)} the ${named}`
  const layout = LAYOUT.exec(file)
  if (layout) return `${designVerb(status)} the ${layout[1]} layout`
  return `${pageVerb(status)} ${file}`
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** The revision a change started from: its parent, or the empty tree for the first commit. */
export function parentOf(root: string, revision: string): string {
  try {
    return git(root, ['rev-parse', '--verify', '--quiet', `${revision}^`]).trim()
  } catch {
    return EMPTY_TREE
  }
}

export type RevisionChange = { file: string; status: ChangeStatus; sentence: string }

/** What going from one revision to another changes, file by file, each with the sentence the publish list would use. */
export function revisionChanges(root: string, from: string, to: string): RevisionChange[] {
  const languages = readSiteConfig(root).languages
  return parseNameStatus(git(root, ['diff', '--name-status', '--no-renames', from, to]))
    .filter((entry) => !ignored(entry.file))
    .map((entry) => {
      // Only a page, an event or a place is named by what it says; reading the others would be a git call each.
      const source = NAMED_BY_SOURCE.some((pattern) => pattern.test(entry.file)) ? sourceAt(root, entry.status === 'D' ? from : to, entry.file) : ''
      return { ...entry, sentence: describeDraftChange(entry.file, entry.status, source, languages) }
    })
}

const NAMED_BY_SOURCE = [PAGE, EVENT, PLACE]

function sourceAt(root: string, revision: string, file: string): string {
  try {
    return git(root, ['show', `${revision}:${file}`])
  } catch {
    return ''
  }
}

function listDraftDiff(root: string): { status: ChangeStatus; file: string }[] {
  const tracked = parseNameStatus(git(root, ['diff', '--name-status', '--no-renames', 'main']))
  const untracked = lines(git(root, ['ls-files', '--others', '--exclude-standard'])).map((file) => ({
    status: 'A' as const,
    file,
  }))
  const byFile = new Map<string, ChangeStatus>()
  for (const entry of [...tracked, ...untracked]) {
    if (!ignored(entry.file)) byFile.set(entry.file, entry.status)
  }
  return [...byFile.entries()].map(([file, status]) => ({ file, status }))
}

function readChangeSource(root: string, entry: { status: ChangeStatus; file: string }): string {
  if (entry.file.startsWith('media/') && entry.file !== 'media/pictures.yml') return ''
  if (entry.status === 'D') {
    try {
      return git(root, ['show', `main:${entry.file}`])
    } catch {
      return ''
    }
  }
  const full = path.join(root, entry.file)
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return fs.readFileSync(full, 'utf8')
  try {
    return git(root, ['show', `draft:${entry.file}`])
  } catch {
    return ''
  }
}

function parseNameStatus(raw: string): { status: ChangeStatus; file: string }[] {
  const entries: { status: ChangeStatus; file: string }[] = []
  for (const line of raw.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const kind = line[0]
    const status: ChangeStatus = kind === 'A' || kind === 'D' ? kind : 'M'
    entries.push({ status, file: line.slice(tab + 1).trim() })
  }
  return entries
}

function ignored(file: string): boolean {
  return (
    file === '.gitignore' ||
    file === 'dist' ||
    file === 'published' ||
    file.startsWith('dist/') ||
    file.startsWith('published/') ||
    file.endsWith('.tmp') ||
    file.includes('.styles.generated')
  )
}

function pageVerb(status: ChangeStatus): string {
  if (status === 'A') return 'Added'
  if (status === 'D') return 'Removed'
  return 'Updated'
}

function designVerb(status: ChangeStatus): string {
  if (status === 'A') return 'Added'
  if (status === 'D') return 'Removed'
  return 'Changed'
}

function localized(source: string, key: string, languages: { id: string; label: string }[]): string | undefined {
  for (const language of languages) {
    const value = mappedValue(source, key, language.id)
    if (value) return value
  }
  return mappedValue(source, key, '') || undefined
}

function mappedValue(source: string, key: string, id: string): string | undefined {
  const lines = source.split(/\r?\n/)
  let inKey = false
  for (const line of lines) {
    if (!inKey) {
      if (line === `${key}:`) {
        inKey = true
        continue
      }
      if (line.startsWith(`${key}:`)) return clean(line.slice(key.length + 1))
      continue
    }
    if (!line.startsWith('  ')) break
    const match = /^  ([A-Za-z0-9-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    if (!id || match[1] === id) return clean(match[2])
  }
  return undefined
}

function clean(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/^['"]|['"]$/g, '').trim()
  return text || undefined
}

function lines(raw: string): string[] {
  return raw.split('\n').map((line) => line.trim()).filter(Boolean)
}
