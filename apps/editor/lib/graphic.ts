import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { fontFaceCss, readFonts, readTokens } from '@schlor/generator'
import { getBrowser, PREVIEW_ORIGIN } from './browser'

/**
 * A graphic made of HTML and CSS: a share card, a banner, words over a picture. The model writes the markup, a browser
 * draws it, and the result is a picture of the site. The page has the site's fonts and colours (as CSS variables, with
 * the names of the design tokens), can show the site's pictures, and can load nothing else: no script runs, and every
 * request that is not a picture or font of the site is stopped.
 */
export const MAX_HTML = 100_000
export const MAX_SIDE = 4096
const DOCUMENT = '/__graphic.html'

export type Graphic = { html: string; width: number; height: number; scale?: number; format?: 'png' | 'jpeg' | 'webp'; transparent?: boolean }
export type Drawn = { bytes: Buffer; format: 'png' | 'jpeg' | 'webp'; width: number; height: number }

/** The site's fonts as @font-face rules and its tokens as CSS variables: --color-primary, --font-serif, --radius-card. */
export function graphicBase(root: string): string {
  const tokens = readTokens(root)
  const variables = [
    ...Object.entries(tokens.colors).map(([name, value]) => `--color-${name}:${value}`),
    ...Object.entries(tokens.fonts).map(([name, value]) => `--font-${name}:${value}`),
    ...Object.entries(tokens.radius).map(([name, value]) => `--radius-${name}:${value}`),
  ]
  return `${fontFaceCss(readFonts(root))}\n:root{${variables.join(';')}}\n*{box-sizing:border-box}`
}

export function graphicDocument(root: string, input: Graphic): string {
  const frame = `html,body{margin:0;padding:0}html{width:${input.width}px;height:${input.height}px;overflow:hidden${input.transparent ? '' : ';background:#fff'}}body{width:${input.width}px;height:${input.height}px;overflow:hidden;position:relative}`
  const style = `<style>${graphicBase(root)}\n${frame}</style>`
  if (/<html[\s>]/i.test(input.html)) {
    if (/<head[\s>]/i.test(input.html)) return input.html.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">${style}`)
    return input.html.replace(/<html([^>]*)>/i, `<html$1><head><meta charset="utf-8">${style}</head>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${input.html}</body></html>`
}

// Only the page itself, and pictures and fonts of the site. The CSP says the same to the page, in case a request slips by.
const POLICY = `default-src 'none'; style-src 'unsafe-inline'; img-src ${PREVIEW_ORIGIN} data:; font-src ${PREVIEW_ORIGIN} data:`
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' }

// Runs in the page, as text so that no build step rewrites it: fonts and pictures are loaded before the picture is taken.
const SETTLE = `(async () => {
  await document.fonts.ready
  await Promise.all(Array.from(document.images).map((image) => (image.complete ? undefined : new Promise((resolve) => { image.onload = image.onerror = resolve }))))
})()`

export async function renderGraphic(root: string, input: Graphic): Promise<Drawn> {
  const scale = input.scale ?? 1
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 16 || input.height < 16) throw new Error('width and height are whole numbers of at least 16, in CSS pixels.')
  if (![1, 2].includes(scale)) throw new Error('scale is 1 or 2.')
  if (input.width * scale > MAX_SIDE || input.height * scale > MAX_SIDE) throw new Error(`A graphic may be at most ${MAX_SIDE} px on a side, scale included. Use a smaller size or scale 1.`)
  if (input.html.length > MAX_HTML) throw new Error(`That HTML is ${Math.round(input.html.length / 1000)} KB. Keep it under ${MAX_HTML / 1000} KB.`)
  const markup = graphicDocument(root, input)
  const media = path.join(root, 'media')
  const context = await (await getBrowser()).newContext({ viewport: { width: input.width, height: input.height }, deviceScaleFactor: scale })
  try {
    await context.route('**/*', async (route) => {
      let url: URL
      try {
        url = new URL(route.request().url())
      } catch {
        return route.abort()
      }
      if (url.origin !== PREVIEW_ORIGIN) return route.abort()
      if (url.pathname === DOCUMENT) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': POLICY }, body: markup })
      if (url.pathname.startsWith('/media/')) {
        let rel: string
        try {
          rel = decodeURIComponent(url.pathname.slice('/media/'.length))
        } catch {
          return route.fulfill({ status: 404, body: '' })
        }
        const file = path.resolve(media, rel)
        const inside = path.relative(media, file)
        const type = TYPES[path.extname(file).toLowerCase()]
        if (!inside.startsWith('..') && !path.isAbsolute(inside) && type && fs.existsSync(file) && fs.statSync(file).isFile()) {
          return route.fulfill({ status: 200, contentType: type, headers: { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }, body: fs.readFileSync(file) })
        }
      }
      return route.fulfill({ status: 404, body: '' })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    await page.goto(`${PREVIEW_ORIGIN}${DOCUMENT}`, { waitUntil: 'load' })
    await page.evaluate(SETTLE)
    const png = await page.screenshot({ type: 'png', omitBackground: input.transparent === true, clip: { x: 0, y: 0, width: input.width, height: input.height } })
    const format = input.format ?? 'png'
    if (input.transparent && format === 'jpeg') throw new Error('A JPEG cannot keep see-through parts. Use png or webp, or leave transparent off.')
    const bytes = format === 'png' ? png : format === 'jpeg' ? await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer() : await sharp(png).webp({ quality: 90 }).toBuffer()
    return { bytes, format, width: input.width * scale, height: input.height * scale }
  } finally {
    await context.close().catch(() => undefined)
  }
}
