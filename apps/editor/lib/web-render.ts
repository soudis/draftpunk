import type { Page } from 'playwright-core'
import { getBrowser } from './browser'
import { assertPublicUrl, safeFetch } from './safe-fetch'

export type FetchPage = (url: string, init: RequestInit & { maxBytes?: number }) => Promise<Response>

export const SITE_VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const
export type SiteViewport = keyof typeof SITE_VIEWPORTS

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const MAX_REQUESTS = 150
const MAX_BYTES = 25_000_000
const OVERALL_MS = 30_000

// Cookie banners and consent walls hide the page and say nothing about its design.
const TIDY = `(() => {
  const hide = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[class*="gdpr" i],[id*="onetrust" i],[class*="onetrust" i],[class*="borlabs" i],[aria-modal="true"]'
  for (const el of document.querySelectorAll(hide)) if (el.tagName !== 'BODY' && el.tagName !== 'HTML' && !el.querySelector('main, h1')) el.style.setProperty('display', 'none', 'important')
  document.documentElement.style.setProperty('overflow', 'auto', 'important')
  if (document.body) document.body.style.setProperty('overflow', 'auto', 'important')
})()`

const SCROLL = `(async () => {
  const step = Math.max(400, window.innerHeight * 0.8)
  const end = Math.min(document.documentElement.scrollHeight, 12000)
  for (let y = 0; y < end; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)) }
  window.scrollTo(0, 0)
  await new Promise((r) => setTimeout(r, 200))
})()`

function forwardedHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (['host', 'cookie', 'authorization', 'connection', 'content-length', 'accept-encoding', 'origin'].includes(name.toLowerCase())) continue
    out[name] = value
  }
  return out
}

/**
 * Open a public page in the browser. The browser never touches the network: every request it makes goes
 * through `fetchPage`, which only reaches public addresses, with a limit on how many and how much.
 */
const REDIRECTS = [301, 302, 303, 307, 308]

/**
 * A browser follows a redirect itself, and does not ask the route again, so it would reach any address a page
 * sends it to, a private one too. So no redirect reaches the browser: they are followed here, one hop at a
 * time, and every hop goes through the same fetch as the first request.
 */
async function fetchFollowing(fetchPage: FetchPage, url: string, init: Parameters<FetchPage>[1], hops = 5): Promise<Response> {
  let current = url
  for (let hop = 0; ; hop += 1) {
    const response = await fetchPage(current, init)
    const location = response.headers.get('location')
    if (!REDIRECTS.includes(response.status) || !location) return response
    if (hop >= hops) throw new Error('too many redirects')
    current = new URL(location, current).href
  }
}

/** Where an address ends up, or the hop that cannot be read. Only the first bytes of each answer are read. */
export async function resolveAddress(fetchPage: FetchPage, url: string, hops = 5): Promise<{ url: string } | { failedAt: string; reason: string }> {
  let current = url
  for (let hop = 0; hop <= hops; hop += 1) {
    let response: Response
    try {
      response = await fetchPage(current, { maxBytes: 1 })
    } catch (error) {
      // The first address failing is for the browser to report; a later one is another site's failure.
      return hop === 0 ? { url } : { failedAt: current, reason: error instanceof Error ? error.message : 'it did not answer' }
    }
    const location = response.headers.get('location')
    if (!REDIRECTS.includes(response.status) || !location) return { url: current }
    try {
      current = new URL(location, current).href
    } catch {
      return { url: current }
    }
  }
  return { failedAt: current, reason: 'too many redirects' }
}

export async function withSitePage<T>(
  input: string,
  options: { viewport?: SiteViewport; fetchPage?: FetchPage },
  run: (page: Page, url: string) => Promise<T>,
): Promise<T> {
  const fetchPage = options.fetchPage ?? safeFetch
  const url = options.fetchPage ? new URL(input.trim()).href : (await assertPublicUrl(input)).href
  const browser = await getBrowser()
  const context = await browser.newContext({
    viewport: SITE_VIEWPORTS[options.viewport ?? 'desktop'],
    userAgent: USER_AGENT,
    serviceWorkers: 'block',
    acceptDownloads: false,
  })
  let requests = 0
  let bytes = 0
  const work = (async () => {
    await context.routeWebSocket(/.*/, (socket) => void socket.close())
    await context.route('**/*', async (route) => {
      const request = route.request()
      const type = request.resourceType()
      if (!['GET', 'HEAD'].includes(request.method()) || ['media', 'websocket', 'eventsource', 'manifest', 'ping'].includes(type)) return route.abort()
      if (requests >= MAX_REQUESTS || bytes >= MAX_BYTES) return route.abort()
      requests += 1
      try {
        const response = await fetchFollowing(fetchPage, request.url(), { headers: forwardedHeaders(await request.allHeaders()), maxBytes: 8_000_000 })
        const body = Buffer.from(await response.arrayBuffer())
        bytes += body.length
        const headers: Record<string, string> = {}
        response.headers.forEach((value, name) => {
          if (!['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie', 'content-security-policy', 'x-frame-options'].includes(name)) headers[name] = value
        })
        return await route.fulfill({ status: response.status, headers, body })
      } catch {
        return route.abort()
      }
    })
    const page = await context.newPage()
    const target = await resolveAddress(fetchPage, url)
    if ('failedAt' in target) {
      throw new Error(`Could not read ${input}: it redirects to ${target.failedAt}, which could not be read: ${target.reason.replace(/\.$/, '')}. That is another site; this page itself is there.`)
    }
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch((error: Error) => {
      const reason = /ERR_NAME_NOT_RESOLVED/.test(error.message)
        ? 'the address does not exist'
        : /Timeout/i.test(error.message)
          ? 'it did not answer in time'
          : 'it could not be reached'
      throw new Error(`Could not read ${input}: ${reason}.`)
    })
    await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => undefined)
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined)
    await page.evaluate(TIDY).catch(() => undefined)
    await page.evaluate(SCROLL).catch(() => undefined)
    await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true').catch(() => undefined)
    return run(page, page.url())
  })()
  const timeout = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`Could not read ${input}: it took longer than ${OVERALL_MS / 1000} seconds.`)), OVERALL_MS).unref())
  try {
    return await Promise.race([work, timeout])
  } finally {
    await context.close().catch(() => undefined)
  }
}
