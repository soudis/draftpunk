import fs from 'node:fs'
import path from 'node:path'
import { readSiteConfig } from '@schlor/generator'
import { git } from './git'

export type ChangeStatus = 'A' | 'M' | 'D'

const PAGE = /^content\/pages\/(.+)\/([a-z]{2}(?:-[a-z0-9]+)*)\.md$/
const EVENT = /^content\/events\/([^/]+)\.yml$/
const PLACE = /^content\/places\/([^/]+)\.yml$/
const LAYOUT = /^design\/layouts\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(?:njk|yml)$/
const PICTURE = /^media\/(.+\.(?:jpe?g|png|webp|gif|svg))$/i

const DESIGN: Record<string, string> = {
  'design/styles.css': 'stylesheet',
  'design/shell.njk': 'shell',
  'design/nav.yml': 'navigation',
  'design/site.yml': 'site name and languages',
  'design/brief.md': 'design brief',
  'design/fields.yml': 'event fields',
  'design/categories.yml': 'categories',
  'design/setup.yml': 'setup',
  'design/proposal.yml': 'setup proposal',
  'content/home.yml': 'homepage news',
  'content/redirects.yml': 'redirects',
  'media/pictures.yml': 'picture descriptions',
}

export function publishChanges(root: string): string[] {
  const languages = readSiteConfig(root).languages
  const sentences = listDraftDiff(root).map((entry) =>
    describeDraftChange(entry.file, entry.status, readChangeSource(root, entry), languages),
  )
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
    const title = frontTitle(source) ?? slug
    return `${pageVerb(status)} the ${languageLabel(languages, page[2])} page ${title}`
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

function languageLabel(languages: { id: string; label: string }[], id: string): string {
  return languages.find((language) => language.id === id)?.label || id
}

function frontTitle(source: string): string | undefined {
  const fence = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fence) return undefined
  const lines = fence[1].split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.startsWith('title:')) continue
    const rest = line.slice('title:'.length).trim()
    if (rest === '>' || rest === '>-' || rest === '|' || rest === '|-') {
      const parts: string[] = []
      for (let next = index + 1; next < lines.length; next++) {
        if (lines[next].trim() && !lines[next].startsWith(' ')) break
        if (lines[next].trim()) parts.push(lines[next].trim())
      }
      return clean(rest.startsWith('|') ? parts.join('\n') : parts.join(' '))
    }
    return clean(rest)
  }
  return undefined
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
