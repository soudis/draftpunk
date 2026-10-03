import fs from 'node:fs'
import path from 'node:path'
import TurndownService from 'turndown'
import { initSite, writePageFile, writeYaml } from '@schlor/generator'
import { parseIcal, splitLanguages, type IcalEvent } from './ical'
import { heroImage, logoImage, parseMenus, rewriteLinks, structureHtml, upgradeImages } from './structure'

const ORIGIN = 'https://schlor.org'
const USER_AGENT = 'schlor-website-import'

const SKIP_SLUGS = new Set(['kalender', 'my-calendar', 'redirections', 'events'])

const ROOM_LEAVES = new Set([
  'wohnen',
  'crap',
  'ateliers',
  'noise',
  'seminarraum',
  'veranstaltungsraum',
  'werkstatt',
  'toepferwerkstatt-scherben',
])

type WpDoc = {
  slug: string
  link: string
  date: string
  title: { rendered: string }
  content: { rendered: string }
  categories?: number[]
}

export async function importWordPress(root: string, origin = ORIGIN): Promise<{ pages: number; news: number; events: number; images: number }> {
  initSite(root)
  fs.rmSync(path.join(root, 'content', 'pages'), { recursive: true, force: true })
  fs.rmSync(path.join(root, 'content', 'events'), { recursive: true, force: true })
  fs.rmSync(path.join(root, 'content', 'places'), { recursive: true, force: true })
  const mediaDir = path.join(root, 'media', 'imported')
  fs.mkdirSync(mediaDir, { recursive: true })
  const images = new Map<string, string>()
  const chrome = await fetchText(`${origin}/`)
  const menus = parseMenus(chrome)
  if (menus.menu.length > 0) writeYaml(path.join(root, 'design', 'nav.yml'), menus)
  const logo = logoImage(chrome)
  if (logo) await downloadExact(logo, path.join(root, 'media', 'logo.png'))
  const slide = heroImage(chrome)

  const [pages, posts, categories] = await Promise.all([
    fetchAll<WpDoc>(`${origin}/wp-json/wp/v2/pages`),
    fetchAll<WpDoc>(`${origin}/wp-json/wp/v2/posts`),
    fetchAll<{ id: number; slug: string; name: string }>(`${origin}/wp-json/wp/v2/categories`),
  ])
  const startseite = categories.find((category) => category.slug === 'startseite')?.id
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  const used = new Set<string>()
  pages.sort((a, b) => Number(b.slug === 'home-2') - Number(a.slug === 'home-2'))

  for (const page of pages) {
    const slug = pageSlug(page)
    if (!slug || SKIP_SLUGS.has(slug) || slug.startsWith('events/') || slug.startsWith('kalender/') || used.has(slug)) continue
    used.add(slug)
    console.log(`page ${slug}`)
    const layout = layoutFor(slug)
    const structured = await structurePage(page.content.rendered, layout, turndown, images, mediaDir)
    if (layout === 'home' && slide) {
      const local = await downloadImage(slide, images, mediaDir)
      const hero = { ...((structured.data.hero as Record<string, unknown> | undefined) ?? {}) }
      if (local) hero.image = local
      structured.data.hero = hero
    }
    writePageFile(path.join(root, 'content', 'pages', slug, 'de.md'), {
      layout,
      title: pageTitle(page, layout),
      body: structured.body,
      data: structured.data,
    })
  }

  const news: { slug: string; date: string }[] = []
  for (const post of posts) {
    let slug = pageSlug(post)
    if (!slug) continue
    if (used.has(slug)) slug = `aktuelles/${slug}`
    used.add(slug)
    console.log(`news ${slug}`)
    const date = post.date.slice(0, 10)
    const body = rewriteLinks(await toMarkdown(post.content.rendered, turndown, images, mediaDir))
    writePageFile(path.join(root, 'content', 'pages', slug, 'de.md'), {
      layout: 'article',
      title: decodeHtml(post.title.rendered),
      date,
      body,
    })
    if (startseite && post.categories?.includes(startseite)) news.push({ slug, date })
  }
  news.sort((a, b) => b.date.localeCompare(a.date))
  writeYaml(path.join(root, 'content', 'home.yml'), { news: news.slice(0, 3).map((item) => item.slug) })

  const parsed = await loadIcalEvents(origin)
  const series = groupEvents(parsed)
  const categoryIds = new Map<string, string>()
  for (const event of series) {
    const place = placeFor(event.location)
    writeYaml(path.join(root, 'content', 'places', `${place.slug}.yml`), place)
    const ids = event.categories.map((name) => categoryId(name, categoryIds))
    const text = splitLanguages(event.description)
    console.log(`event ${event.slug}`)
    writeYaml(path.join(root, 'content', 'events', `${event.slug}.yml`), {
      slug: event.slug,
      title: { de: event.summary, en: text.en ? event.summary : '' },
      body: { de: text.de, en: text.en },
      place: place.slug,
      categories: ids,
      dates: event.dates,
    })
  }
  writeYaml(
    path.join(root, 'design', 'categories.yml'),
    [...categoryIds.entries()].map(([id, label]) => ({ id, de: label, en: label })),
  )

  return { pages: pages.length, news: posts.length, events: series.length, images: images.size }
}

function pageTitle(doc: WpDoc, layout: string): string {
  const fallback = decodeHtml(doc.title.rendered)
  if (layout !== 'home') return fallback
  const heading = doc.content.rendered.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  const text = heading ? decodeHtml(heading[1]) : ''
  return text || fallback
}

function pageSlug(doc: WpDoc): string | undefined {
  const pathname = new URL(doc.link).pathname.replace(/^\/|\/$/g, '')
  if (pathname === '' || pathname === 'home' || pathname === 'home-2' || doc.slug === 'home-2') return 'home'
  if (!/^[a-z0-9/-]+$/.test(pathname)) return undefined
  return pathname
}

function layoutFor(slug: string): string {
  const leaf = slug.split('/').at(-1) ?? slug
  if (slug === 'home') return 'home'
  if (leaf === 'presse' || leaf === 'material') return 'gallery'
  if (leaf === 'verbuendete') return 'allies'
  if (ROOM_LEAVES.has(leaf) || slug.startsWith('crap/')) return 'room'
  return 'article'
}

async function structurePage(
  html: string,
  layout: string,
  turndown: TurndownService,
  images: Map<string, string>,
  mediaDir: string,
) {
  const prepared = upgradeImages(revealEmails(stripForms(html))).replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  const localized = await localizeImages(prepared, images, mediaDir)
  return structureHtml(layout, localized, (fragment) => markdownFragment(fragment, turndown))
}

async function toMarkdown(html: string, turndown: TurndownService, images: Map<string, string>, mediaDir: string): Promise<string> {
  const localized = await localizeImages(upgradeImages(revealEmails(stripForms(html))), images, mediaDir)
  return markdownFragment(localized, turndown)
}

function markdownFragment(html: string, turndown: TurndownService): string {
  const cleaned = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '').replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  return turndown.turndown(cleaned).replace(/\n{3,}/g, '\n\n').trim()
}

function stripForms(html: string): string {
  return html.replace(/<form[\s\S]*?<\/form>/gi, '')
}

function revealEmails(html: string): string {
  return html.replace(/<a\b[^>]*data-enc-email="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi, (_, encoded: string) => {
    const email = rot13(encoded.replace('[at]', '@'))
    return `<a href="mailto:${email}">${email}</a>`
  })
}

function rot13(value: string): string {
  return value.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base)
  })
}

async function localizeImages(html: string, images: Map<string, string>, mediaDir: string): Promise<string> {
  const urls = [...html.matchAll(/https?:\/\/[^"'\\\s>]+/g)]
    .map((match) => match[0].replace(/&amp;/g, '&'))
    .filter((url) => /wp-content\/uploads\//.test(url))
  const unique = [...new Set(urls)]
  await Promise.all(unique.map((url) => downloadImage(url, images, mediaDir)))
  let next = html
  for (const url of unique) {
    const local = images.get(url)
    if (local) next = next.replaceAll(url, local).replaceAll(url.replaceAll('&', '&amp;'), local)
  }
  return next
}

async function downloadImage(url: string, images: Map<string, string>, mediaDir: string): Promise<string | undefined> {
  const cached = images.get(url)
  if (cached) return cached
  const name = path.basename(new URL(url).pathname).replace(/[^a-zA-Z0-9._-]/g, '')
  if (!name) return undefined
  const file = path.join(mediaDir, name)
  if (!fs.existsSync(file)) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) })
      if (!response.ok) return undefined
      fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()))
    } catch {
      return undefined
    }
  }
  const local = `/media/imported/${name}`
  images.set(url, local)
  return local
}

async function downloadExact(url: string, file: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) return
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()))
}

type Series = IcalEvent & { slug: string; dates: { start: string; end?: string }[] }

function groupEvents(events: IcalEvent[]): Series[] {
  const grouped = new Map<string, Series>()
  for (const event of events) {
    const slug = eventSlug(event)
    const current = grouped.get(slug)
    const date = { start: event.start, end: event.end }
    if (!current) {
      grouped.set(slug, { ...event, slug, dates: [date] })
      continue
    }
    current.dates.push(date)
  }
  return [...grouped.values()].map((event) => ({
    ...event,
    dates: usefulDates(event.dates),
  }))
}

function usefulDates(dates: { start: string; end?: string }[]): { start: string; end?: string }[] {
  const seen = new Set<string>()
  const unique = dates.filter((date) => {
    if (seen.has(date.start)) return false
    seen.add(date.start)
    return true
  })
  const short = unique.filter((date) => {
    if (!date.end) return true
    return new Date(date.end).getTime() - new Date(date.start).getTime() < 18 * 60 * 60 * 1000
  })
  const chosen = short.length > 0 ? short : unique.slice(0, 1)
  return chosen.sort((a, b) => a.start.localeCompare(b.start))
}

function eventSlug(event: IcalEvent): string {
  if (event.url) {
    const leaf = new URL(event.url).pathname.split('/').filter(Boolean).at(-1)
    if (leaf && /^[a-z0-9-]+$/.test(leaf)) return leaf
  }
  return slugify(event.summary) || 'event'
}

function placeFor(location: string): { slug: string; name: { de: string; en: string }; address?: string; onPremises: boolean } {
  const text = location || 'SchloR'
  const onPremises = /rappach|schlor|crap|trap|seminar|werkstatt|veranstalt/i.test(text)
  const slug = onPremises && /rappach|schlor/i.test(text) ? 'rappachgasse' : slugify(text) || 'anderswo'
  return { slug, name: { de: text, en: text }, address: text, onPremises }
}

function categoryId(label: string, ids: Map<string, string>): string {
  const id = slugify(label) || 'sonstiges'
  if (!ids.has(id)) ids.set(id, label)
  return id
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

async function fetchAll<T>(url: string): Promise<T[]> {
  const all: T[] = []
  for (let page = 1; page < 40; page++) {
    const response = await fetch(`${url}?per_page=100&page=${page}`, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) break
    const data = (await response.json()) as T[]
    if (!Array.isArray(data) || data.length === 0) break
    all.push(...data)
    const total = Number(response.headers.get('x-wp-totalpages') ?? '1')
    if (page >= total) break
  }
  return all
}

async function loadIcalEvents(origin: string): Promise<IcalEvent[]> {
  const events: IcalEvent[] = []
  for (const url of [`${origin}/?ical=1`, `${origin}/?ical=1&scope=past&limit=500`]) {
    events.push(...parseIcal(await fetchText(url)))
  }
  const sitemap = await fetchText(`${origin}/event-sitemap.xml`)
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1])
    .filter((loc) => /\/events\/[^/]+\/$/.test(new URL(loc).pathname))
  const pages = await mapPool(locs, 8, async (loc) => {
    try {
      return parseIcal(await fetchText(`${loc.replace(/\/$/, '')}/ical/`))
    } catch {
      return []
    }
  })
  events.push(...pages.flat())
  console.log(`ical events ${events.length} from ${locs.length} event pages`)
  return events
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await fn(items[index])
      }
    }),
  )
  return results
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Could not read ${url}`)
  return response.text()
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/<[^>]+>/g, '')
    .trim()
}
