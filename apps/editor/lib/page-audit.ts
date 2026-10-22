import path from 'node:path'
import fs from 'node:fs'
import { readSiteConfig, pageUrl, type PageExpectation } from '@schlor/generator'
import { decideRoute, getBrowser, PREVIEW_ORIGIN } from './browser'

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
} as const
// A tall page is cut here: the picture only has to show the look, and a model reads it by its size.
const MAX_SHOT_HEIGHT = 2400

export type ViewportName = keyof typeof VIEWPORTS

type Offender = { fg: string; bg: string; ratio: number; need: number; sel: string; text: string; count: number }

export type RawAudit = {
  width: number
  scrollWidth: number
  title: string
  h1: number
  text: string
  invisible: boolean
  brokenImages: string[]
  overflow: { sel: string; right: number }[]
  contrast: Offender[]
}

// Runs inside the page. It is a string, not a function, so a build step cannot rewrite it.
const AUDIT_SOURCE = `(() => {
  const w = window.innerWidth
  const html = document.documentElement
  const body = document.body
  const describe = (el) => {
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/)[0] : ''
    return el.tagName.toLowerCase() + id + cls
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const cache = new Map()
  const rgba = (color) => {
    if (cache.has(color)) return cache.get(color)
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    const value = [d[0], d[1], d[2], d[3] / 255]
    cache.set(color, value)
    return value
  }
  const mix = (top, bottom) => [0, 1, 2].map((i) => top[3] * top[i] + (1 - top[3]) * bottom[i])
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const backdrop = (el) => {
    const layers = []
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.backgroundImage !== 'none') return null
      const c = rgba(cs.backgroundColor)
      if (c[3] > 0) layers.push(c)
      if (c[3] >= 1) break
    }
    let base = [255, 255, 255]
    for (let i = layers.length - 1; i >= 0; i--) base = mix(layers[i], base)
    return base
  }
  const opacityOf = (el) => {
    let o = 1
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
    return o
  }
  const out = {
    width: w,
    scrollWidth: html.scrollWidth,
    title: document.title,
    h1: document.querySelectorAll('h1').length,
    text: body ? body.innerText : '',
    invisible: [html, body].some((e) => e && Number(getComputedStyle(e).opacity) < 0.05),
    brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.getAttribute('src')).slice(0, 8),
    overflow: [],
    contrast: [],
  }
  if (html.scrollWidth > w + 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > w + 1) out.overflow.push({ sel: describe(el), right: Math.round(r.right) })
    }
    out.overflow.sort((a, b) => b.right - a.right)
    out.overflow = out.overflow.slice(0, 5)
  }
  const groups = new Map()
  let seen = 0
  for (const el of document.querySelectorAll('body *')) {
    if (seen > 900) break
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'].includes(el.tagName.toUpperCase())) continue
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)) continue
    seen++
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || cs.visibility !== 'visible' || cs.display === 'none') continue
    const opacity = opacityOf(el)
    if (opacity < 0.5) continue
    const bg = backdrop(el)
    if (!bg) continue
    const color = rgba(cs.color)
    const fg = mix([color[0], color[1], color[2], color[3] * opacity], bg)
    const size = parseFloat(cs.fontSize)
    const large = size >= 24 || (parseInt(cs.fontWeight, 10) >= 700 && size >= 18.66)
    const need = large ? 3 : 4.5
    const l1 = lum(fg)
    const l2 = lum(bg)
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    if (ratio >= need) continue
    const key = hex(fg) + '|' + hex(bg)
    const known = groups.get(key)
    if (known) { known.count++; continue }
    groups.set(key, { fg: hex(fg), bg: hex(bg), ratio: Math.round(ratio * 10) / 10, need, sel: describe(el), text: el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30), count: 1 })
  }
  out.contrast = [...groups.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 4)
  return out
})()`

export type PageAudit = {
  path: string
  viewport: ViewportName
  findings: string[]
  screenshot?: Buffer
}

/** The sentences a model can act on, from what the page reported. */
export function describeAudit(audit: RawAudit, extra: { errors: string[]; missing: string[]; hidden: string[] }): string[] {
  const findings: string[] = []
  if (audit.invisible) findings.push('The page is invisible: html or body has opacity 0.')
  else if (audit.text.trim().length < 20) findings.push('The page shows almost no text.')
  if (audit.h1 === 0) findings.push('The page has no main heading (h1).')
  if (audit.overflow.length > 0) {
    const reaching = audit.overflow.map((item) => `${item.sel} reaches ${item.right}px`).join(', ')
    findings.push(`The page scrolls sideways at ${audit.width}px wide (it is ${audit.scrollWidth}px): ${reaching}.`)
  }
  if (audit.brokenImages.length > 0) findings.push(`Pictures that did not load: ${audit.brokenImages.join(', ')}.`)
  for (const item of audit.contrast) {
    const more = item.count > 1 ? ` and ${item.count - 1} more like it` : ''
    findings.push(`Text ${item.fg} on ${item.bg} has contrast ${item.ratio}:1 and needs ${item.need}:1: ${item.sel} “${item.text}”${more}.`)
  }
  if (extra.hidden.length > 0) findings.push(`These page words are in the page but not visible: ${extra.hidden.join(', ')}.`)
  if (extra.missing.length > 0) findings.push(`Not found: ${extra.missing.slice(0, 5).join(', ')}.`)
  for (const error of extra.errors.slice(0, 3)) findings.push(`The page logged an error: ${error}`)
  return findings
}

const norm = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** Slot texts that are in the generated page but that a reader does not see (display none, clipped away). */
export function hiddenWords(expectation: PageExpectation | undefined, shown: string): string[] {
  if (!expectation) return []
  const seen = norm(shown)
  return expectation.texts.filter((item) => !seen.includes(norm(item.expected))).map((item) => item.path)
}

export function pagePath(root: string, page: string, lang?: string): string {
  if (page.startsWith('/')) return page
  const site = readSiteConfig(root)
  return pageUrl(page, lang ?? site.languages[0]?.id ?? 'de', site)
}

export async function auditPage(
  root: string,
  urlPath: string,
  viewport: ViewportName,
  options: { screenshot?: 'viewport' | 'full'; expectations?: PageExpectation[] } = {},
): Promise<PageAudit> {
  const dist = path.join(root, 'dist')
  const size = VIEWPORTS[viewport]
  const browser = await getBrowser()
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
  try {
    const page = await context.newPage()
    const errors: string[] = []
    const missing: string[] = []
    page.on('pageerror', (error) => errors.push(error.message.split('\n')[0]))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text().split('\n')[0])
    })
    await context.route('**/*', async (route) => {
      const decision = decideRoute(dist, route.request().url())
      if (decision.kind === 'file') return route.fulfill({ status: 200, contentType: decision.type, body: fs.readFileSync(decision.file) })
      if (decision.kind === 'missing') {
        missing.push(new URL(route.request().url()).pathname)
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
      }
      if (decision.kind === 'allow') return route.continue()
      return route.abort()
    })
    await page.goto(`${PREVIEW_ORIGIN}${urlPath}`, { waitUntil: 'load', timeout: 15_000 })
    await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true').catch(() => undefined)
    const audit = (await page.evaluate(AUDIT_SOURCE)) as RawAudit
    const expectation = options.expectations?.find((item) => item.url === urlPath)
    const findings = describeAudit(audit, { errors, missing, hidden: hiddenWords(expectation, audit.text) })
    let screenshot: Buffer | undefined
    if (options.screenshot) {
      const full = options.screenshot === 'full'
      const height = full ? Math.min(MAX_SHOT_HEIGHT, Number(await page.evaluate('document.documentElement.scrollHeight'))) : size.height
      screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 72,
        fullPage: full,
        clip: full ? { x: 0, y: 0, width: size.width, height } : undefined,
      })
    }
    return { path: urlPath, viewport, findings, screenshot }
  } finally {
    await context.close().catch(() => undefined)
  }
}
