import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nunjucks from 'nunjucks'
import { type EventDoc, type Lang, type PlaceDoc, readYaml, renderContent } from './content'
import { buildMonths, toIcal, weekdayLabels, type CalendarEvent } from './calendar'
import {
  eventContentFile,
  markBody,
  markContent,
  pageContentFile,
  placeContentFile,
  plainContent,
  revealContentHints,
} from './hints'
import {
  layoutExists,
  layoutFolder,
  layoutTemplatePath,
  listLayoutNames,
  pageLayouts,
  readLayout,
  scopeLayoutCss,
} from './layouts'
import {
  languageIds,
  localeFor,
  readEventFields,
  readLabels,
  readSiteConfig,
  shownEventFields,
  type SiteConfig,
} from './model'
import { listPageSlugs, pageHasLanguage, readPage, writePage, type PageFile } from './pages'
import { describe, enhanceHead, enhancePictures, robotsTxt, sitemapXml, type PageMeta } from './baseline'
import { searchIndexJson, searchText, type SearchEntry } from './search'
import { fontFaceCss, fontPreloadLinks, readFonts } from './fonts'
import { resolveSlots } from './slots'
import { readTokens, tokensCss } from './tokens'

export type GenerateResult = {
  pages: number
  events: number
  outDir: string
}

type NavItem = { href: string; label: Record<Lang, string>; children?: NavItem[] }
type NavFile = { menu?: NavItem[]; footer?: NavItem[] }

type HomeFile = { news?: string[] }

export type GenerateOptions = { hints?: boolean }

export function generate(root: string, outDir = path.join(root, 'dist'), options?: GenerateOptions): GenerateResult {
  const hints = options?.hints ?? path.resolve(outDir) === path.resolve(root, 'dist')
  const tmp = `${outDir}.tmp`
  fs.rmSync(tmp, { recursive: true, force: true })
  try {
    const result = generateInto(root, tmp, hints)
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.renameSync(tmp, outDir)
    return { ...result, outDir }
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true })
    throw error
  }
}

function generateInto(root: string, outDir: string, hints: boolean): GenerateResult {
  const designDir = path.join(root, 'design')
  const site = readSiteConfig(root)
  const env = nunjucks.configure([designDir], { autoescape: true, noCache: true, throwOnUndefined: false })
  env.addGlobal('assets', site.assets)
  env.addFilter('plain', (value: unknown) => (typeof value === 'string' ? plainContent(value) : value))
  env.addFilter('formatDay', (iso: string, lang: Lang) => {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(localeFor(lang), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: site.timezone,
    }).format(date)
  })

  fs.mkdirSync(outDir, { recursive: true })
  copyMedia(path.join(root, 'media'), path.join(outDir, 'media'))
  const faces = readFonts(root)
  buildCss(designDir, path.join(outDir, 'assets', 'styles.css'), `${fontFaceCss(faces)}\n${assetsCss(site.assets)}`)

  const navFile = readYaml<NavFile | NavItem[]>(path.join(designDir, 'nav.yml'), [])
  const menu = Array.isArray(navFile) ? navFile : (navFile.menu ?? [])
  const footer = Array.isArray(navFile) ? [] : (navFile.footer ?? [])
  const pages = loadPages(root)
  const places = loadPlaces(root)
  const events = loadEvents(root)
  const home = readYaml<HomeFile>(path.join(root, 'content', 'home.yml'), {})
  const defaultLang = site.languages[0]?.id ?? 'de'
  const news = pages
    .filter((page) => page.lang === defaultLang && page.date)
    .sort((a, b) => (a.date! < b.date! ? 1 : -1))
  const selected = (home.news ?? []).map((slug) => news.find((page) => page.slug === slug)).filter((page): page is PageView => Boolean(page))
  const homeNews = (selected.length > 0 ? selected : news.slice(0, 3)).map((page) => page.slug)

  const fields = readEventFields(root)
  const preload = fontPreloadLinks(faces)
  const themeColor = readTokens(root).colors.primary
  const written: string[] = []
  const put = (urlPath: string, html: string, meta: PageMeta) => {
    writeHtml(outDir, urlPath, html, hints, (shown) => enhanceHead(enhancePictures(shown, root), meta, site, { preload, themeColor }))
    if (!meta.noindex) written.push(urlPath)
  }
  // The search needs the design to have its page; a site made before it has none, and gets neither the page nor the index.
  const searchOn = layoutExists(designDir, 'search')
  let pageCount = 0
  for (const language of site.languages) {
    const lang = language.id
    env.addGlobal('labels', readLabels(root, lang))
    env.addGlobal('search', searchOn ? routePath('/suche/', lang, site) : '')
    const entries: SearchEntry[] = []
    for (const page of pages.filter((item) => item.lang === lang)) {
      const url = pageUrl(page.slug, lang, site)
      const html = renderPage(env, designDir, page, lang, site, menu, footer, pages, homeNews, events, places, hints)
      put(url, html, {
        title: page.title,
        description: pageDescription(designDir, page, lang),
        lang,
        path: url,
      })
      entries.push({ t: page.title, u: url, k: page.date ? 'post' : 'page', x: searchText(html), ...(page.date ? { d: page.date } : {}) })
      pageCount += 1
    }
    const blog = routePath('/blog/', lang, site)
    put(blog, renderArchive(env, lang, site, menu, footer, pages, hints), { title: heading(lang, 'Aktuelles', 'News'), lang, path: blog })
    const calendar = routePath('/kalender/', lang, site)
    put(calendar, renderCalendar(env, lang, site, menu, footer, events, places, hints), { title: heading(lang, 'Kalender', 'Calendar'), lang, path: calendar })
    for (const event of events) {
      const eventPath = eventUrl(event.slug, lang, site)
      const html = renderEvent(env, event, lang, site, fields, menu, footer, places, hints)
      put(eventPath, html, {
        title: event.title[lang] || event.slug,
        description: describe(renderContent(event.body[lang] || '')),
        lang,
        path: eventPath,
      })
      if (event.title[lang]?.trim()) entries.push({ t: event.title[lang], u: eventPath, k: 'event', x: searchText(html) })
    }
    if (events.length > 0) {
      const index = routePath('/events/', lang, site)
      put(index, renderEventIndex(env, lang, site, menu, footer, events, hints), { title: heading(lang, 'Termine', 'Events'), lang, path: index })
    }
    if (searchOn) {
      const labels = readLabels(root, lang)
      const searchPath = routePath('/suche/', lang, site)
      put(searchPath, renderSearch(env, lang, site, menu, footer, hints), { title: labels.search_title || heading(lang, 'Suche', 'Search'), lang, path: searchPath, noindex: true })
      fs.writeFileSync(path.join(outDir, `search-index.${lang}.json`), searchIndexJson(entries))
    }
  }

  env.addGlobal('labels', readLabels(root, defaultLang))
  env.addGlobal('search', searchOn ? routePath('/suche/', defaultLang, site) : '')
  writeHtml(outDir, '/404.html', renderNotFound(env, defaultLang, site, menu, footer, hints), hints, (shown) =>
    enhanceHead(enhancePictures(shown, root), { title: readLabels(root, defaultLang).not_found_title ?? '404', lang: defaultLang, path: '/404.html' }, { name: site.name }, { preload, themeColor }),
  )
  fs.writeFileSync(path.join(outDir, 'robots.txt'), robotsTxt(site))
  if (site.url) fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml({ url: site.url }, written))

  const icalEvents = events.flatMap((event) =>
    event.dates.flatMap((date, index) => {
      const start = new Date(date.start)
      if (Number.isNaN(start.getTime())) return []
      const end = date.end ? new Date(date.end) : undefined
      return [{
        uid: `${event.slug}-${index}@${site.id}`,
        title: textFor(event.title, defaultLang),
        start,
        end: end && !Number.isNaN(end.getTime()) ? end : undefined,
        description: textFor(event.body, defaultLang),
        place: textFor(places.get(event.place)?.name ?? {}, defaultLang),
      }]
    }),
  )
  fs.mkdirSync(path.join(outDir, 'kalender'), { recursive: true })
  fs.writeFileSync(
    path.join(outDir, 'kalender', `${site.id}.ics`),
    toIcal(icalEvents, `-//${site.name}//website//${defaultLang.toUpperCase()}`),
  )

  const redirects = readYaml<{ from: string; to: string }[]>(path.join(root, 'content', 'redirects.yml'), [])
  for (const redirect of redirects) {
    const from = redirect.from.endsWith('/') ? redirect.from : `${redirect.from}/`
    writeHtml(
      outDir,
      from,
      `<!doctype html><meta charset="utf-8"><link rel="canonical" href="${redirect.to}"><meta http-equiv="refresh" content="0; url=${redirect.to}"><title>Weiterleitung</title><p><a href="${redirect.to}">Weiter</a></p>`,
      hints,
    )
  }

  return { pages: pageCount, events: events.length, outDir }
}

export function replaceLayout(root: string, from: string, to: string): string[] {
  if (from === to) return []
  const designDir = path.join(root, 'design')
  if (!layoutExists(designDir, to)) throw new Error(`Layout ${to} does not exist`)
  if ((['event', 'calendar', 'archive'] as string[]).includes(from)) {
    throw new Error(`Layout ${from} is part of the calendar and archive. Overwrite the file instead of removing it.`)
  }
  const updated: string[] = []
  for (const slug of listPageSlugs(root)) {
    const page = readPage(root, slug)
    if (!page || page.layout !== from) continue
    writePage(root, { ...page, layout: to })
    updated.push(slug)
  }
  fs.rmSync(layoutFolder(designDir, from), { recursive: true, force: true })
  return updated
}

export function pageLayoutsOrThrow(root: string, layout: string): void {
  const names = pageLayouts(path.join(root, 'design'))
  if (!names.includes(layout)) throw new Error(`Unknown layout ${layout}. Choose one of: ${names.join(', ')}`)
}

type PageView = { slug: string; lang: Lang; layout: string; title: string; date?: string; file: PageFile }

function loadPages(root: string): PageView[] {
  const views: PageView[] = []
  const languages = languageIds(root)
  for (const slug of listPageSlugs(root)) {
    const file = readPage(root, slug)
    if (!file) continue
    for (const lang of languages) {
      if (pageHasLanguage(file, lang)) views.push({ slug, lang, layout: file.layout, title: file.title[lang], date: file.date, file })
    }
  }
  return views
}

function loadPlaces(root: string): Map<string, PlaceDoc> {
  const dir = path.join(root, 'content', 'places')
  const map = new Map<string, PlaceDoc>()
  if (!fs.existsSync(dir)) return map
  for (const name of fs.readdirSync(dir).filter((item) => item.endsWith('.yml'))) {
    const place = readYaml<PlaceDoc>(path.join(dir, name), {
      slug: name.replace(/\.yml$/, ''),
      name: { de: name, en: name },
      onPremises: true,
    })
    map.set(place.slug, place)
  }
  return map
}

function loadEvents(root: string): EventDoc[] {
  const dir = path.join(root, 'content', 'events')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => readYaml<EventDoc>(path.join(dir, name), emptyEvent(name.replace(/\.yml$/, ''))))
    .sort((a, b) => (a.dates[0]?.start ?? '').localeCompare(b.dates[0]?.start ?? ''))
}

function emptyEvent(slug: string): EventDoc {
  return { slug, title: {}, body: {}, place: '', categories: [], dates: [] }
}

function renderPage(
  env: nunjucks.Environment,
  designDir: string,
  page: PageView,
  lang: Lang,
  site: SiteConfig,
  nav: NavItem[],
  footer: NavItem[],
  pages: PageView[],
  homeNews: string[],
  events: EventDoc[],
  places: Map<string, PlaceDoc>,
  hints: boolean,
): string {
  const file = pageContentFile(page.slug)
  const news = homeNews
    .map((slug) => pages.find((item) => item.slug === slug && item.lang === lang))
    .filter((item): item is PageView => Boolean(item))
    .map((item) => {
      const newsFile = pageContentFile(item.slug)
      return {
        title: newsFile ? tag(item.title, newsFile, `title.${lang}`, hints) : item.title,
        href: pageUrl(item.slug, lang, site),
        date: item.date,
      }
    })
  const upcoming = upcomingEvents(events, lang, site, places, hints).slice(0, 5)
  const hasPage = (language: string) => pages.some((item) => item.slug === page.slug && item.lang === language)
  if (!layoutExists(designDir, page.layout)) throw new Error(`Page ${page.slug} uses layout ${page.layout}, which does not exist`)
  const layout = readLayout(designDir, page.layout)
  const slots = resolveSlots(layout.slots, page.file.slots, lang, {
    text: (source, at) => (file && hints ? markContent(source, { file, field: at }) : source),
    markdown: (source, at) => safe(file && hints ? markBody(source, file, at) : renderContent(source)),
  })
  const context = baseContext(
    file ? tag(page.title, file, `title.${lang}`, hints) : page.title,
    lang,
    site,
    nav,
    footer,
    (language) => pageUrl(page.slug, language, site),
    hasPage,
    { news, upcoming, date: page.date, slots },
  )
  return withLayoutAttribute(env.render(layoutTemplatePath(page.layout), context), page.layout)
}

/** Mark the page with its layout, so the layout's own styles apply to it and to nothing else. */
function withLayoutAttribute(html: string, layout: string): string {
  return html.replace(/<body\b([^>]*)>/i, (_all, attrs: string) => `<body${attrs} data-layout="${layout}">`)
}

function renderNotFound(env: nunjucks.Environment, lang: Lang, site: SiteConfig, nav: NavItem[], footer: NavItem[], hints: boolean): string {
  const has = () => false
  return withLayoutAttribute(
    env.render(
      layoutTemplatePath('notfound'),
      baseContext(((env.getGlobal('labels') as Record<string, string> | undefined)?.not_found_title) ?? '404', lang, site, nav, footer, () => '/404.html', has, {}),
    ),
    'notfound',
  )
}

function renderSearch(env: nunjucks.Environment, lang: Lang, site: SiteConfig, nav: NavItem[], footer: NavItem[], hints: boolean): string {
  void hints
  const labels = env.getGlobal('labels') as Record<string, string> | undefined
  return withLayoutAttribute(
    env.render(layoutTemplatePath('search'), baseContext(labels?.search_title || heading(lang, 'Suche', 'Search'), lang, site, nav, footer, (language) => routePath('/suche/', language, site), () => true, {})),
    'search',
  )
}

const DESCRIPTION_SLOTS = ['lede', 'summary', 'intro', 'description', 'teaser']

/** What a page says about itself in a line: its lede, or else the start of its text. */
function pageDescription(designDir: string, page: PageView, lang: Lang): string {
  if (!layoutExists(designDir, page.layout)) return ''
  const schema = readLayout(designDir, page.layout).slots
  const text = (name: string): string => {
    const value = page.file.slots[name]
    if (!value || typeof value !== 'object') return typeof value === 'string' ? value : ''
    const found = (value as Record<string, unknown>)[lang]
    return typeof found === 'string' ? found : ''
  }
  for (const name of DESCRIPTION_SLOTS) {
    const def = schema[name]
    if (def && (def.type === 'text' || def.type === 'markdown') && text(name).trim()) return describe(def.type === 'markdown' ? renderContent(text(name)) : text(name))
  }
  const body = Object.entries(schema).find(([name, def]) => def.type === 'markdown' && text(name).trim())
  return body ? describe(renderContent(text(body[0]))) : ''
}

function renderArchive(env: nunjucks.Environment, lang: Lang, site: SiteConfig, nav: NavItem[], footer: NavItem[], pages: PageView[], hints: boolean): string {
  const items = pages
    .filter((page) => page.lang === lang && page.date)
    .sort((a, b) => (a.date! < b.date! ? 1 : -1))
    .map((page) => {
      const file = pageContentFile(page.slug)
      return {
        title: file ? tag(page.title, file, `title.${lang}`, hints) : page.title,
        href: pageUrl(page.slug, lang, site),
        date: page.date,
      }
    })
  const has = () => true
  return withLayoutAttribute(
    env.render(
      layoutTemplatePath('archive'),
      baseContext(heading(lang, 'Aktuelles', 'News'), lang, site, nav, footer, (language) => routePath('/blog/', language, site), has, { items }),
    ),
    'archive',
  )
}

function renderCalendar(
  env: nunjucks.Environment,
  lang: Lang,
  site: SiteConfig,
  nav: NavItem[],
  footer: NavItem[],
  events: EventDoc[],
  places: Map<string, PlaceDoc>,
  hints: boolean,
): string {
  const dated = calendarEvents(events, lang, site, hints)
  const months = buildMonths(dated, lang, new Date(), 5, site.timezone)
  const has = () => true
  return withLayoutAttribute(
    env.render(
      layoutTemplatePath('calendar'),
      baseContext(heading(lang, 'Kalender', 'Calendar'), lang, site, nav, footer, (language) => routePath('/kalender/', language, site), has, {
        months,
        weekdays: weekdayLabels(lang),
        upcoming: upcomingEvents(events, lang, site, places, hints),
        ical: `/kalender/${site.id}.ics`,
      }),
    ),
    'calendar',
  )
}

function renderEvent(
  env: nunjucks.Environment,
  event: EventDoc,
  lang: Lang,
  site: SiteConfig,
  fields: ReturnType<typeof readEventFields>,
  nav: NavItem[],
  footer: NavItem[],
  places: Map<string, PlaceDoc>,
  hints: boolean,
): string {
  const place = places.get(event.place)
  const file = eventContentFile(event.slug)
  const bodySource = event.body[lang] || ''
  const has = (language: string) => Boolean((event.body[language] ?? '').trim())
  const body = safe(file && hints ? markBody(bodySource, file, `body.${lang}`) : renderContent(bodySource))
  return withLayoutAttribute(
    env.render(
      layoutTemplatePath('event'),
      baseContext(eventTitle(event, lang, hints), lang, site, nav, footer, (language) => eventUrl(event.slug, language, site), has, {
        body,
        dates: event.dates,
        place: placeText(place, lang, hints) || event.place,
        address: placeAddress(place, hints),
        categories: event.categories,
        shownFields: shownEventFields(event, fields, lang),
      }),
    ),
    'event',
  )
}

function renderEventIndex(env: nunjucks.Environment, lang: Lang, site: SiteConfig, nav: NavItem[], footer: NavItem[], events: EventDoc[], hints: boolean): string {
  const items = events.map((event) => ({
    title: eventTitle(event, lang, hints),
    href: eventUrl(event.slug, lang, site),
    date: event.dates[0]?.start.slice(0, 10),
  }))
  const has = () => true
  return withLayoutAttribute(
    env.render(
      layoutTemplatePath('archive'),
      baseContext(heading(lang, 'Termine', 'Events'), lang, site, nav, footer, (language) => routePath('/events/', language, site), has, { items }),
    ),
    'archive',
  )
}

function baseContext(
  title: string,
  lang: Lang,
  site: SiteConfig,
  nav: NavItem[],
  footer: NavItem[],
  hrefFor: (lang: string) => string,
  hasContent: (lang: string) => boolean,
  extra: Record<string, unknown>,
) {
  const prefix = prefixFor(lang, site)
  const alternates = site.languages
    .filter((language) => language.id !== lang && hasContent(language.id))
    .map((language) => ({ href: hrefFor(language.id), label: language.label, hreflang: language.id }))
  return {
    title,
    lang,
    name: site.name,
    prefix,
    nav: localizeNav(nav, lang, prefix),
    footer: localizeNav(footer, lang, prefix),
    alternate: alternates[0]?.href ?? hrefFor(otherLang(lang, site)),
    showAlternate: alternates.length > 0,
    alternates,
    year: new Date().getFullYear(),
    ...extra,
  }
}

function localizeNav(items: NavItem[], lang: Lang, prefix: string): { href: string; label: string; children?: { href: string; label: string }[] }[] {
  return items.map((item) => ({
    href: item.href.startsWith('http') ? item.href : `${prefix}${item.href}`,
    label: item.label[lang] || item.label.de,
    children: item.children ? localizeNav(item.children, lang, prefix) : undefined,
  }))
}

function upcomingEvents(events: EventDoc[], lang: Lang, site: SiteConfig, places: Map<string, PlaceDoc>, hints: boolean) {
  const now = Date.now()
  return events
    .flatMap((event) =>
      event.dates
        .filter((date) => new Date(date.start).getTime() >= now - 24 * 60 * 60 * 1000)
        .map((date) => ({
          title: eventTitle(event, lang, hints),
          href: eventUrl(event.slug, lang, site),
          start: date.start,
          place: placeText(places.get(event.place), lang, hints) || event.place,
        })),
    )
    .sort((a, b) => a.start.localeCompare(b.start))
}

function calendarEvents(events: EventDoc[], lang: Lang, site: SiteConfig, hints: boolean): CalendarEvent[] {
  return events.flatMap((event) =>
    event.dates.flatMap((date) => {
      const start = new Date(date.start)
      if (Number.isNaN(start.getTime())) return []
      const end = date.end ? new Date(date.end) : undefined
      return [{
        slug: event.slug,
        title: eventTitle(event, lang, hints),
        href: eventUrl(event.slug, lang, site),
        start,
        end: end && !Number.isNaN(end.getTime()) ? end : undefined,
      }]
    }),
  )
}

// Nunjucks escapes everything it prints. A value that is already HTML must say so.
function safe(html: string): unknown {
  return (nunjucks.runtime as unknown as { markSafe: (value: string) => unknown }).markSafe(html)
}

function tag(text: string, file: string, field: string, hints: boolean): string {
  if (!hints || !text) return text
  return markContent(text, { file, field })
}

function eventTitle(event: EventDoc, lang: string, hints: boolean): string {
  const text = event.title[lang]
  const file = eventContentFile(event.slug)
  if (!text) return event.slug
  if (!file) return text
  return tag(text, file, `title.${lang}`, hints)
}

function placeText(place: PlaceDoc | undefined, lang: string, hints: boolean): string {
  if (!place) return ''
  let text = ''
  let field = ''
  if (place.name?.[lang]?.trim()) {
    text = place.name[lang]
    field = `name.${lang}`
  } else {
    const found = Object.entries(place.name ?? {}).find(([, value]) => value?.trim())
    if (!found) return ''
    text = found[1]
    field = `name.${found[0]}`
  }
  const file = placeContentFile(place.slug)
  if (!file) return text
  return tag(text, file, field, hints)
}

function placeAddress(place: PlaceDoc | undefined, hints: boolean): string | undefined {
  if (!place?.address) return undefined
  const file = placeContentFile(place.slug)
  if (!file) return place.address
  return tag(place.address, file, 'address', hints)
}

function prefixFor(lang: string, site: SiteConfig): string {
  return lang === site.languages[0]?.id ? '' : `/${lang}`
}

function routePath(urlPath: string, lang: string, site: SiteConfig): string {
  const prefix = prefixFor(lang, site)
  if (urlPath === '/') return prefix ? `${prefix}/` : '/'
  return `${prefix}${urlPath}`
}

/** Where the generated page of a slug and language is written. */
export function pageOutputFile(root: string, outDir: string, slug: string, lang: Lang): string {
  const url = pageUrl(slug, lang, readSiteConfig(root))
  return path.join(outDir, url.endsWith('/') ? `${url}index.html` : url)
}

export function pageUrl(slug: string, lang: Lang, site: SiteConfig): string {
  if (slug === 'home') return routePath('/', lang, site)
  return routePath(`/${slug}/`, lang, site)
}

function eventUrl(slug: string, lang: Lang, site: SiteConfig): string {
  return routePath(`/events/${slug}/`, lang, site)
}

function otherLang(lang: string, site: SiteConfig): string {
  const ids = site.languages.map((language) => language.id)
  const index = ids.indexOf(lang)
  return ids[(index + 1) % Math.max(ids.length, 1)] ?? lang
}

function heading(lang: string, german: string, english: string): string {
  if (lang === 'de') return german
  if (lang === 'en') return english
  return english
}

function textFor(values: Record<string, string>, lang: string): string {
  return values[lang]?.trim() || Object.values(values).find((value) => value?.trim()) || ''
}

function writeHtml(outDir: string, urlPath: string, html: string, hints: boolean, post: (html: string) => string = (shown) => shown): void {
  const rel = urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath
  const file = path.join(outDir, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, post(hints ? revealContentHints(html) : html))
}

function copyMedia(from: string, to: string): void {
  if (!fs.existsSync(from)) return
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'pictures.yml') continue
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isDirectory()) copyMedia(src, dest)
    else if (entry.isFile()) fs.copyFileSync(src, dest)
  }
}

/** The site's pictures as custom properties, so a stylesheet can use one (background-image: var(--asset-pattern)) without holding an address. */
export function assetsCss(assets: Record<string, string>): string {
  const lines = Object.entries(assets).map(([name, address]) => `  --asset-${name}: url("${address}");`)
  return lines.length === 0 ? '' : `:root {\n${lines.join('\n')}\n}`
}

function buildCss(designDir: string, outFile: string, fontCss = ''): void {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const cli = tailwindCli()
  const original = fs.readFileSync(path.join(designDir, 'styles.css'), 'utf8')
  const input = path.join(designDir, '.styles.generated.css')
  const entry = tailwindEntry().replaceAll('\\', '/')
  const imported = original.includes('@import "tailwindcss";')
    ? original.replace('@import "tailwindcss";', `@import "${entry}";`)
    : `@import "${entry}";\n${original}`
  const theme = tokensCss(readTokens(path.dirname(designDir)))
  const layoutStyles = listLayoutNames(designDir)
    .map((name) => {
      const file = path.join(layoutFolder(designDir, name), 'style.css')
      return fs.existsSync(file) ? scopeLayoutCss(name, fs.readFileSync(file, 'utf8')) : ''
    })
    .filter(Boolean)
    .join('\n')
  fs.writeFileSync(input, `${imported}\n${fontCss}\n${theme}\n${layoutStyles}\n`)
  try {
    const result = spawnSync(process.execPath, [cli, '--input', input, '--output', outFile], {
      cwd: designDir,
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(`Tailwind failed: ${result.stderr || result.stdout}`)
    }
  } finally {
    fs.rmSync(input, { force: true })
  }
}

function tailwindEntry(): string {
  const relative = path.join('tailwindcss', 'index.css')
  const starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]
  for (const start of starts) {
    let dir = start
    for (let i = 0; i < 8; i++) {
      const direct = path.join(dir, 'node_modules', relative)
      if (fs.existsSync(direct)) return direct
      const pnpmDir = path.join(dir, 'node_modules', '.pnpm')
      if (fs.existsSync(pnpmDir)) {
        for (const entry of fs.readdirSync(pnpmDir)) {
          if (!entry.startsWith('tailwindcss@')) continue
          const nested = path.join(pnpmDir, entry, 'node_modules', relative)
          if (fs.existsSync(nested)) return nested
        }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw new Error('Tailwind CSS is not installed')
}

function tailwindCli(): string {
  // A static require.resolve is compiled into a numeric module id, which is not a file path.
  const relative = path.join('@tailwindcss', 'cli', 'dist', 'index.mjs')
  const starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]
  for (const start of starts) {
    let dir = start
    for (let i = 0; i < 8; i++) {
      const direct = path.join(dir, 'node_modules', relative)
      if (fs.existsSync(direct)) return direct
      const pnpmDir = path.join(dir, 'node_modules', '.pnpm')
      if (fs.existsSync(pnpmDir)) {
        for (const entry of fs.readdirSync(pnpmDir)) {
          if (!entry.startsWith('@tailwindcss+cli@')) continue
          const nested = path.join(pnpmDir, entry, 'node_modules', relative)
          if (fs.existsSync(nested)) return nested
        }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw new Error('The Tailwind CLI is not installed')
}
