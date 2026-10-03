import fs from 'node:fs'
import path from 'node:path'

const TEXT = new Set(['.md', '.yml', '.yaml'])
const MATCH_LIMIT = 40
const LINE_LIMIT = 180

export function searchContent(root: string, query: string): string {
  const needle = query.trim().replace(/\s+/g, ' ')
  if (needle.length < 2) return 'Pass a phrase of at least two characters to search pages, events, and places.'
  const folded = needle.toLowerCase()
  const dir = path.join(root, 'content')
  if (!fs.existsSync(dir)) return 'No content to search.'
  const hits: string[] = []
  let extra = 0
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile() || !TEXT.has(path.extname(entry.name).toLowerCase())) continue
      const rel = path.relative(root, full).split(path.sep).join('/')
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLowerCase().includes(folded)) continue
        if (hits.length >= MATCH_LIMIT) {
          extra += 1
          continue
        }
        hits.push(`${rel}:${index + 1}: ${snippet(lines[index], folded)}`)
      }
    }
  }
  walk(dir)
  if (hits.length === 0) return `No content matches ${needle}.`
  const more = extra > 0 ? `\n\nAnd ${extra} more matches. Narrow the query.` : ''
  return `${hits.join('\n')}${more}`
}

function snippet(line: string, foldedNeedle: string): string {
  const clean = line.replace(/\s+/g, ' ').trim()
  if (clean.length <= LINE_LIMIT) return clean
  const at = clean.toLowerCase().indexOf(foldedNeedle)
  const start = Math.max(0, (at < 0 ? 0 : at) - 50)
  const end = Math.min(clean.length, start + LINE_LIMIT)
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`
}
