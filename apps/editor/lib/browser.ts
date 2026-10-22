import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser } from 'playwright-core'

// The browser is optional. BROWSER_URL points at a Chromium that speaks the DevTools protocol (a sidecar
// container, for example http://chromium:9222). BROWSER_PATH runs a local Chrome or Chromium instead.
export function browserConfigured(): boolean {
  return Boolean(process.env.BROWSER_URL?.trim() || process.env.BROWSER_PATH?.trim())
}

let shared: Promise<Browser> | undefined

export async function getBrowser(): Promise<Browser> {
  if (!shared) {
    shared = connect().catch((error) => {
      shared = undefined
      throw error
    })
    void shared.then((browser) => browser.on('disconnected', () => (shared = undefined))).catch(() => undefined)
  }
  return shared
}

async function connect(): Promise<Browser> {
  const url = process.env.BROWSER_URL?.trim()
  if (url) return chromium.connectOverCDP(url, { timeout: 10_000 })
  const executablePath = process.env.BROWSER_PATH?.trim()
  if (!executablePath) throw new Error('No browser is configured. Set BROWSER_URL or BROWSER_PATH.')
  return chromium.launch({
    executablePath,
    headless: true,
    timeout: 15_000,
    args: process.env.BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox'] : [],
  })
}

export async function closeBrowser(): Promise<void> {
  const current = shared
  shared = undefined
  if (current) await (await current.catch(() => undefined))?.close().catch(() => undefined)
}

export const PREVIEW_ORIGIN = 'http://preview.test'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ics': 'text/calendar',
  '.txt': 'text/plain; charset=utf-8',
}

// Fonts are part of how a page looks. Nothing else leaves the machine from a preview.
const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

export type RouteDecision =
  | { kind: 'file'; file: string; type: string }
  | { kind: 'missing' }
  | { kind: 'allow' }
  | { kind: 'block' }

/** What to do with a request a preview page makes: serve it from the generated site, let a font through, or stop it. */
export function decideRoute(distDir: string, requested: string): RouteDecision {
  let url: URL
  try {
    url = new URL(requested)
  } catch {
    return { kind: 'block' }
  }
  if (url.origin !== PREVIEW_ORIGIN) return ALLOWED_HOSTS.has(url.hostname) && url.protocol === 'https:' ? { kind: 'allow' } : { kind: 'block' }
  let rel: string
  try {
    rel = decodeURIComponent(url.pathname)
  } catch {
    return { kind: 'missing' }
  }
  let file = path.resolve(distDir, `.${rel}`)
  const inside = path.relative(distDir, file)
  if (inside.startsWith('..') || path.isAbsolute(inside)) return { kind: 'missing' }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { kind: 'missing' }
  return { kind: 'file', file, type: TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' }
}
