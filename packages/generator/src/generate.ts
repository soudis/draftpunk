import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nunjucks from 'nunjucks'
import {
  type EventDoc,
  type Lang,
  type PageDoc,
  type PlaceDoc,
  contentPagePath,
  listLayoutNames,
  pageLayouts,
  listPageSlugs,
  readPageFile,
  readYaml,
  renderContent,
  writePageFile,
} from './content'
import { buildMonths, toIcal, weekdayLabels, type CalendarEvent } from './calendar'
import {
  eventContentFile,
  markBody,
  markContent,
  markContentValue,
  pageContentFile,
  placeContentFile,
  plainContent,
  revealContentHints,
} from './hints'
import {
  languageIds,
  layoutHasTemplate,
  localeFor,
  readEventFields,
  readLayoutSections,
  readSiteConfig,
  shownEventFields,
  type SiteConfig,
} from './model'

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

function shapesDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shapes')
}

function generateInto(root: string, outDir: string, hints: boolean): GenerateResult {
  const designDir = path.join(root, 'design')
  const site = readSiteConfig(root)
  const env = nunjucks.configure([designDir, shapesDir()], { autoescape: true, noCache: true, throwOnUndefined: false })
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
  buildCss(designDir, path.join(outDir, 'assets', 'styles.css'), shapesDir())

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
  const selected = (home.news ?? []).map((slug) => news.find((page) => page.slug === slug)).filter((page): page is PageDoc => Boolean(page))
  const homeNews = (selected.length > 0 ? selected : news.slice(0, 3)).map((page) => page.slug)

  const fields = readEventFields(root)
  let pageCount = 0
  for (const language of site.languages) {
    const lang = language.id
    for (const page of pages.filter((item) => item.lang === lang)) {
      const url = pageUrl(page.slug, lang, site)
      writeHtml(outDir, url, renderPage(env, designDir, page, lang, site, menu, footer, pages, homeNews, events, places, hints), hints)
      pageCount += 1
    }
    writeHtml(outDir, routePath('/blog/', lang, site), renderArchive(env, lang, site, menu, footer, pages, hints), hints)
    writeHtml(outDir, routePath('/kalender/', lang, site), renderCalendar(env, lang, site, menu, footer, events, places, hints), hints)
    for (const event of events) {
      writeHtml(outDir, eventUrl(event.slug, lang, site), renderEvent(env, event, lang, site, fields, menu, footer, places, hints), hints)
    }
    if (events.length > 0) {
      writeHtml(outDir, routePath('/events/', lang, site), renderEventIndex(env, lang, site, menu, footer, events, hints), hints)
    }
  }

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
  const layouts = new Set(listLayoutNames(path.join(root, 'design')))
  if (!layouts.has(to)) throw new Error(`Layout ${to} does not exist`)
  if ((['event', 'calendar', 'archive'] as string[]).includes(from)) {
    throw new Error(`Layout ${from} is part of the calendar and archive. Overwrite the file instead of removing it.`)
  }
  const updated: string[] = []
  const pagesDir = path.join(root, 'content', 'pages')
  if (!fs.existsSync(pagesDir)) return updated
  for (const slug of listPageSlugs(root)) {
    let touched = false
    for (const lang of languageIds(root)) {
      const file = contentPagePath(root, slug, lang)
      if (!fs.existsSync(file)) continue
      const doc = readPageFile(file, slug, lang)
      if (doc.layout !== from) continue
      writePageFile(file, { ...doc, layout: to })
      touched = true
    }
    if (touched) updated.push(slug)
  }
  for (const ext of ['.njk', '.yml']) {
    const layoutFile = path.join(root, 'design', 'layouts', `${from}${ext}`)
    if (fs.existsSync(layoutFile)) fs.rmSync(layoutFile)
  }
  return updated
}

export function pageLayoutsOrThrow(root: string, layout: string): void {
  const names = pageLayouts(path.join(root, 'design'))
  if (!names.includes(layout)) throw new Error(`Unknown layout ${layout}. Choose one of: ${names.join(', ')}`)
}

function loadPages(root: string): PageDoc[] {
  const pages: PageDoc[] = []
  for (const slug of listPageSlugs(root)) {
    for (const lang of languageIds(root)) {
      const file = contentPagePath(root, slug, lang)
      if (fs.existsSync(file)) pages.push(readPageFile(file, slug, lang))
    }
  }
  return pages
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
  page: PageDoc,
  lang: Lang,
  site: SiteConfig,
  nav: NavItem[],
  footer: NavItem[],
  pages: PageDoc[],
  homeNews: string[],
  events: EventDoc[],
  places: Map<string, PlaceDoc>,
  hints: boolean,
): string {
  const file = pageContentFile(page.slug, lang)
  const news = homeNews
    .map((slug) => pages.find((item) => item.slug === slug && item.lang === lang))
    .filter((item): item is PageDoc => Boolean(item))
    .map((item) => {
      const newsFile = pageContentFile(item.slug, lang)
      return {
        title: newsFile ? tag(item.title, newsFile, 'title', hints) : item.title,
        href: pageUrl(item.slug, lang, site),
        date: item.date,
      }
    })
  const upcoming = upcomingEvents(events, lang, site, places, hints).slice(0, 5)
  const hasPage = (language: string) =>
    pages.some((item) => item.slug === page.slug && item.lang === language && item.body.trim().length > 0)
  const context = baseContext(
    file ? tag(page.title, file, 'title', hints) : page.title,
    file && hints ? markBody(page.body, file, 'body') : renderContent(page.body),
    lang,
    site,
    nav,
    footer,
    (language) => pageUrl(page.slug, language, site),
    hasPage,
    {
      news,
      upcoming,
      date: page.date,
      hero: shown(page.data.hero, file, 'hero', hints),
      cards: shown(page.data.cards, file, 'cards', hints),
      band: shown(page.data.band, file, 'band', hints),
      images: shown(page.data.images, file, 'images', hints),
      email: shown(page.data.email, file, 'email', hints),
      groups: shown(page.data.groups, file, 'groups', hints),
      slots: file && hints ? markContentValue(pageSlots(page.data), file, 'slots') : pageSlots(page.data),
    },
  )
  if (layoutHasTemplate(designDir, page.layout)) return env.render(`layouts/${page.layout}.njk`, context)
  const sections = readLayoutSections(designDir, page.layout)
  if (!sections) throw new Error(`Layout ${page.layout} has no template and no sections`)
  return env.render('page.njk', { ...context, sections })
}

function renderArchive(env: nunjucks.Environment, lang: Lang, site: SiteConfig, nav: NavItem[], footer: NavItem[], pages: PageDoc[], hints: boolean): string {
  const items = pages
    .filter((page) => page.lang === lang && page.date)
    .sort((a, b) => (a.date! < b.date! ? 1 : -1))
    .map((page) => {
      const file = pageContentFile(page.slug, lang)
      return {
        title: file ? tag(page.title, file, 'title', hints) : page.title,
        href: pageUrl(page.slug, lang, site),
        date: page.date,
      }
    })
  const has = () => true
  return env.render(
    'layouts/archive.njk',
    baseContext(heading(lang, 'Aktuelles', 'News'), '', lang, site, nav, footer, (language) => routePath('/blog/', language, site), has, { items }),
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
  return env.render(
    'layouts/calendar.njk',
    baseContext(heading(lang, 'Kalender', 'Calendar'), '', lang, site, nav, footer, (language) => routePath('/kalender/', language, site), has, {
      months,
      weekdays: weekdayLabels(lang),
      upcoming: upcomingEvents(events, lang, site, places, hints),
      ical: `/kalender/${site.id}.ics`,
    }),
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
  return env.render(
    'layouts/event.njk',
    baseContext(eventTitle(event, lang, hints), file && hints ? markBody(bodySource, file, `body.${lang}`) : renderContent(bodySource), lang, site, nav, footer, (language) => eventUrl(event.slug, language, site), has, {
      dates: event.dates,
      place: placeText(place, lang, hints) || event.place,
      address: placeAddress(place, hints),
      categories: event.categories,
      shownFields: shownEventFields(event, fields, lang),
    }),
  )
}

function renderEventIndex(env: nunjucks.Environment, lang: Lang, site: SiteConfig, nav: NavItem[], footer: NavItem[], events: EventDoc[], hints: boolean): string {
  const items = events.map((event) => ({
    title: eventTitle(event, lang, hints),
    href: eventUrl(event.slug, lang, site),
    date: event.dates[0]?.start.slice(0, 10),
  }))
  const has = () => true
  return env.render(
    'layouts/archive.njk',
    baseContext(heading(lang, 'Termine', 'Events'), '', lang, site, nav, footer, (language) => routePath('/events/', language, site), has, { items }),
  )
}

function baseContext(
  title: string,
  body: string,
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
    body,
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

function pageSlots(data: Record<string, unknown>): Record<string, unknown> {
  const slots = { ...data }
  delete slots.layout
  delete slots.title
  delete slots.date
  return slots
}

function tag(text: string, file: string, field: string, hints: boolean): string {
  if (!hints || !text) return text
  return markContent(text, { file, field })
}

function shown(value: unknown, file: string | null, field: string, hints: boolean): unknown {
  if (!hints || !file) return value
  return markContentValue(value, file, field)
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

function pageUrl(slug: string, lang: Lang, site: SiteConfig): string {
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

function writeHtml(outDir: string, urlPath: string, html: string, hints: boolean): void {
  const rel = urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath
  const file = path.join(outDir, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, hints ? revealContentHints(html) : html)
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

function buildCss(designDir: string, outFile: string, shapes: string): void {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const cli = tailwindCli()
  const relative = path.relative(designDir, shapes).split(path.sep).join('/')
  const original = fs.readFileSync(path.join(designDir, 'styles.css'), 'utf8')
  const input = path.join(designDir, '.styles.generated.css')
  const entry = tailwindEntry().replaceAll('\\', '/')
  const imported = original.includes('@import "tailwindcss";')
    ? original.replace('@import "tailwindcss";', `@import "${entry}";`)
    : `@import "${entry}";\n${original}`
  const withSource = `${imported}\n@source "${relative}";\n`
  fs.writeFileSync(input, withSource)
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
