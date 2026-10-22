import fs from 'node:fs'
import path from 'node:path'
import { fail } from './tool-kit'

export type Reference = { host: string; note: string; saved: string }

const HOST = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

export function hostOf(input: string): string {
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
  } catch {
    return fail(`${input} is not a web address.`)
  }
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

export function referenceFile(root: string, host: string): string {
  if (!HOST.test(host)) fail(`${host} is not a site name such as example.org.`)
  return path.join(root, 'design', 'references', `${host}.md`)
}

/** A site the person likes, with what they like about it and how it looks, for later chats to match. */
export function saveReference(root: string, input: { url: string; note: string; profile: string }, now = new Date()): string {
  const host = hostOf(input.url)
  const file = referenceFile(root, host)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const body = input.profile.replace(/^# .*\n/, '')
  fs.writeFileSync(file, `# ${host}\nSource: ${input.url}\nSaved: ${now.toISOString().slice(0, 10)}\nNote: ${input.note.trim().replace(/\s+/g, ' ')}\n\n${body.trim()}\n`)
  return host
}

export function readReference(root: string, host: string): string {
  const file = referenceFile(root, hostOf(host))
  if (!fs.existsSync(file)) fail(`No saved reference for ${host}. Saved: ${listReferences(root).map((item) => item.host).join(', ') || 'none'}.`)
  return fs.readFileSync(file, 'utf8')
}

export function listReferences(root: string): Reference[] {
  const dir = path.join(root, 'design', 'references')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const text = fs.readFileSync(path.join(dir, name), 'utf8')
      return {
        host: name.slice(0, -3),
        note: /^Note: (.*)$/m.exec(text)?.[1] ?? '',
        saved: /^Saved: (.*)$/m.exec(text)?.[1] ?? '',
      }
    })
}
