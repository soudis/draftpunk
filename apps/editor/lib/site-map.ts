import { safeFetch } from './safe-fetch'
import type { FetchPage } from './web-render'

export type SiteLink = { path: string; label: string }

const SKIP_EXT = /\.(?:jpe?g|png|gif|webp|svg|ico|pdf|zip|css|js|json|xml|mp3|mp4|woff2?|ics)(?:\?|$)/i

function sameSite(a: string, b: string): boolean {
  return a.replace(/^www\./, '') === b.replace(/^www\./, '')
}

/** The pages a page links to on its own site, with the words of the link. */
export function internalLinks(html: string, pageUrl: string): SiteLink[] {
  const base = new URL(pageUrl)
  const seen = new Map<string, string>()
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(match[1])?.[2]
    if (!href || /^(?:#|mailto:|tel:|javascript:)/i.test(href)) continue
    let url: URL
    try {
      url = new URL(href.replace(/&amp;/g, '&'), base)
    } catch {
      continue
    }
    if (!/^https?:$/.test(url.protocol) || !sameSite(url.hostname, base.hostname) || SKIP_EXT.test(url.pathname)) continue
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const label = match[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
    if (!seen.has(path) || (!seen.get(path) && label)) seen.set(path, label)
  }
  return [...seen.entries()].map(([path, label]) => ({ path, label }))
}

/** The addresses in a sitemap.xml, and the sitemaps it points at. */
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => match[1].replace(/&amp;/g, '&'))
  return /<sitemapindex/i.test(xml) ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] }
}

function pathsOf(urls: string[], base: URL): string[] {
  const paths = new Set<string>()
  for (const raw of urls) {
    try {
      const url = new URL(raw)
      if (sameSite(url.hostname, base.hostname) && !SKIP_EXT.test(url.pathname)) paths.add(url.pathname.replace(/\/+$/, '') || '/')
    } catch {
      continue
    }
  }
  return [...paths].sort()
}

/** Pages grouped by their first part when there are many, so the list stays short. */
export function summarizePaths(paths: string[], limit = 60): string[] {
  if (paths.length <= limit) return paths
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    const first = `/${path.split('/')[1] ?? ''}`
    groups.set(first, [...(groups.get(first) ?? []), path])
  }
  const lines: string[] = []
  for (const [first, members] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (members.length > 8) lines.push(`${first}/… (${members.length} pages, for example ${members.slice(0, 2).join(', ')})`)
    else lines.push(...members)
  }
  return lines.slice(0, limit)
}

const REDIRECTS = [301, 302, 303, 307, 308]

/** A page's text and the address it was finally read at: redirects (http to https, www, a trailing slash) are followed, each hop through the same fetch. */
async function page(fetchPage: FetchPage, url: string, accept: string): Promise<{ body: string; url: string } | null> {
  let current = url
  try {
    for (let hop = 0; hop <= 5; hop += 1) {
      const response = await fetchPage(current, { headers: { accept }, maxBytes: 600_000, redirect: 'manual' })
      const location = response.headers.get('location')
      if (REDIRECTS.includes(response.status) && location) {
        current = new URL(location, current).href
        continue
      }
      return response.ok ? { body: await response.text(), url: current } : null
    }
  } catch {
    return null
  }
  return null
}

async function text(fetchPage: FetchPage, url: string, accept: string): Promise<string | null> {
  return (await page(fetchPage, url, accept))?.body ?? null
}

/** The pages a sitemap lists, found through robots.txt or /sitemap.xml. */
async function sitemapPaths(url: URL, fetchPage: FetchPage): Promise<string[]> {
  const robots = (await text(fetchPage, `${url.origin}/robots.txt`, 'text/plain,*/*;q=0.1')) ?? ''
  const declared = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((match) => match[1])
  const roots = declared.length > 0 ? declared : [`${url.origin}/sitemap.xml`]
  const found: string[] = []
  const queue = roots.slice(0, 3)
  for (let step = 0; step < 6 && queue.length > 0; step += 1) {
    const next = queue.shift() as string
    const xml = await text(fetchPage, next, 'application/xml,text/xml,*/*;q=0.1')
    if (!xml) continue
    const parsed = parseSitemap(xml)
    found.push(...parsed.pages)
    queue.push(...parsed.sitemaps.slice(0, 3))
  }
  return pathsOf(found, url)
}

function siteUrl(input: string): URL {
  return new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
}

/** Every page path of a site that its sitemap or its front page names, and whether a sitemap was found. */
export async function collectPaths(input: string, fetchPage: FetchPage = safeFetch): Promise<{ origin: string; paths: string[]; sitemap: boolean }> {
  const asked = siteUrl(input)
  const first = await page(fetchPage, asked.href, 'text/html,*/*;q=0.1')
  if (first === null) throw new Error(`Could not read ${asked.href}.`)
  const url = new URL(first.url)
  const listed = await sitemapPaths(url, fetchPage)
  const linked = internalLinks(first.body, url.href).map((link) => link.path)
  return { origin: url.origin, paths: [...new Set([...listed, ...linked])].sort(), sitemap: listed.length > 0 }
}

export async function siteMap(input: string, fetchPage: FetchPage = safeFetch): Promise<string> {
  const asked = siteUrl(input)
  const first = await page(fetchPage, asked.href, 'text/html,*/*;q=0.1')
  if (first === null) throw new Error(`Could not read ${asked.href}.`)
  const url = new URL(first.url)
  const links = internalLinks(first.body, url.href)
  const lines = [`Links on ${url.href} to the same site (${links.length}):`, ...links.slice(0, 60).map((link) => `- ${link.path}${link.label ? ` — ${link.label}` : ''}`)]
  if (links.length > 60) lines.push(`… and ${links.length - 60} more.`)
  const paths = await sitemapPaths(url, fetchPage)
  lines.push('', paths.length === 0 ? 'No sitemap was found.' : `Sitemap lists ${paths.length} pages:`, ...summarizePaths(paths).map((path) => `- ${path}`))
  return lines.join('\n')
}
