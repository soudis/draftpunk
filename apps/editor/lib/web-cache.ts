import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DAY = 24 * 60 * 60 * 1000

/** Keep what a site said for a few hours, so the same page is not rendered again for each question. */
export async function cached(dir: string | undefined, key: string, compute: () => Promise<string>, ttlMs = 6 * 60 * 60 * 1000, now = Date.now()): Promise<string> {
  if (!dir) return compute()
  const file = path.join(dir, `${createHash('sha1').update(key).digest('hex').slice(0, 24)}.json`)
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { at: number; value: string }
    if (now - stored.at < ttlMs) return stored.value
  } catch {
    // Nothing kept yet, or it cannot be read.
  }
  const value = await compute()
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ at: now, value }))
    prune(dir, now)
  } catch {
    // A cache that cannot be written is not an error.
  }
  return value
}

function prune(dir: string, now: number): void {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)
    if (now - fs.statSync(file).mtimeMs > 7 * DAY) fs.rmSync(file, { force: true })
  }
}
