import fs from 'node:fs'
import path from 'node:path'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import { searchContent } from './content-search'
import { guardDesignWrite } from './layout-guard'
import type { EditorMode } from './mode'
import { browserConfigured } from './browser'
import { cached } from './web-cache'
import { lintDesign, newFindings } from './design-lint'
import { addFont, tokenFontsWithoutFiles } from './fonts-add'
import { addRule } from './rules'
import { listReferences, readReference, saveReference } from './references'
import { formatProfile, PROFILE_SOURCE, type RawProfile } from './site-profile'
import { DATE_SOURCE, formatText, TEXT_SOURCE, type RawText } from './site-text'
import { collectPaths, siteMap } from './site-map'
import { forgetImported, importedFrom, importPages, normalPath, DEFAULT_BATCH, MAX_BATCH } from './import-pages'
import { buildNav, MENU_SOURCE, resolverFor, writeMenu, type MenuEntry } from './source-menu'
import { safeFetch } from './safe-fetch'
import { resolveAddress, SITE_VIEWPORTS, withSitePage, type FetchPage, type SiteViewport } from './web-render'
import { replaceOnce } from './edit'
import { slotDefAt, slotPath, valueAt, withValueAt } from './slot-edit'
import { auditPage, pagePath, type ViewportName } from './page-audit'
import { documentOpacityRefusal } from './page-opacity'
import { suggestPicture } from './picture-vision'
import { detectPicture, discardPicture, fitPicture, pictureByOrigin, readPicture, searchPictures, stemFromFilename, storePicture } from './pictures'
import { fetchPublicBytes, readWebsite } from './read-website'
import { screenshotMarker, ScreenshotStore } from './screenshots'
import { defineTool, fail } from './tool-kit'
import { createVerifier, verifyDesign, type Verifier } from './verify'
import {
  assertSlug,
  applyProposal,
  checkLayout,
  checkPage,
  contrastWarnings,
  parseTokens,
  readTokens,
  deletePage,
  designFilePath,
  forkLayout,
  formatCatalog,
  generate,
  labelNames,
  labelReferences,
  layoutCatalog,
  layoutExists,
  listLayoutNames,
  listPageSlugs,
  lostContent,
  pageFilePath,
  pageLayoutsOrThrow,
  pagesByLayout,
  parseFonts,
  parseLabels,
  parseLayoutFile,
  readEventFields,
  readLayout,
  readLayoutFiles,
  readPage,
  readProposal,
  assetProblems,
  readYaml,
  readSiteConfig,
  recordProposal,
  slotExpectations,
  removeLayoutFolder,
  replaceLayout,
  slotReferences,
  writeLayout,
  writePage,
  writeYaml,
  type EventDoc,
  type PageFile,
  type PlaceDoc,
  type SetupProposal,
} from '@schlor/generator'

// A design file longer than this is returned in pieces. The reply names the offset to continue from.
export const DESIGN_READ_LIMIT = 24_000

const languageText = z.union([z.string(), z.record(z.string(), z.string())])
type LanguageText = z.infer<typeof languageText>

function pages(root: string): string[] {
  const language = defaultLanguage(root)
  return listPageSlugs(root).map((slug) => {
    const page = readPage(root, slug)
    if (!page) return slug
    const title = page.title[language] || Object.values(page.title)[0] || slug
    return [slug, title, page.layout, page.date].filter(Boolean).join(' — ')
  })
}

/** Generate the site. After a design change, also say which words a page no longer shows. */
function finish(root: string, summary: string, options: { design?: boolean } = {}): string {
  generate(root)
  if (!options.design) return summary
  const lost = lostContent(root)
  if (lost.length === 0) return summary
  return `${summary}\nThese words are no longer shown, so the layout dropped or hid them: ${lost.join('; ')}. Show every slot on its page.`
}

/** A design change: build, report dropped words, then look at the pages in a browser when one is set up. */
async function finishDesign(root: string, summary: string, verifier: Verifier, layout?: string): Promise<string> {
  const built = finish(root, summary, { design: true })
  const seen = await verifyDesign(root, verifier, layout)
  return seen ? `${built}\n${seen}` : built
}

function removePage(root: string, slug: string): string {
  if (slug === 'home') fail('The home page cannot be removed.')
  assertSlug(slug)
  if (!deletePage(root, slug)) fail(`Missing page ${slug}`)
  forgetImported(root, [slug])
  return finish(root, `Removed page ${slug}.`)
}

/** Remove many pages at once: the ones named, and the ones an import took from a part of its source. */
function removePages(root: string, input: { slugs?: string[]; source_prefix?: string }): string {
  const names = new Set(input.slugs ?? [])
  if (input.source_prefix?.trim()) for (const slug of importedFrom(root, input.source_prefix)) names.add(slug)
  if (names.size === 0) fail('Name the pages in slugs, or give source_prefix such as /events/ for the pages an import took from there.')
  const removed: string[] = []
  const missing: string[] = []
  for (const slug of names) {
    if (slug === 'home') continue
    assertSlug(slug)
    if (deletePage(root, slug)) removed.push(slug)
    else missing.push(slug)
  }
  forgetImported(root, removed)
  const lines = [`Removed ${removed.length} page${removed.length === 1 ? '' : 's'}${removed.length > 0 ? `: ${removed.slice(0, 12).join(', ')}${removed.length > 12 ? `, and ${removed.length - 12} more` : ''}` : ''}.`]
  if (missing.length > 0) lines.push(`Not found: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? `, and ${missing.length - 8} more` : ''}.`)
  lines.push('Pictures stay in the media library, and links to these pages on other pages now lead nowhere.')
  return finish(root, lines.join(' '))
}

function readContentYaml(root: string, folder: 'events' | 'places', slug: string, label: string): string {
  assertSlug(slug)
  const file = path.join(root, 'content', folder, `${slug}.yml`)
  if (!fs.existsSync(file)) fail(`Missing ${label} ${slug}`)
  return fs.readFileSync(file, 'utf8')
}

function removeYaml(root: string, folder: 'events' | 'places', slug: string, label: string): string {
  assertSlug(slug)
  const file = path.join(root, 'content', folder, `${slug}.yml`)
  if (!fs.existsSync(file)) fail(`Missing ${label} ${slug}`)
  fs.rmSync(file)
  return finish(root, `Removed ${label} ${slug}.`)
}

function defaultLanguage(root: string): string {
  return readSiteConfig(root).languages[0]?.id ?? 'de'
}

function languageChoice(root: string): string {
  const ids = readSiteConfig(root).languages.map((language) => language.id)
  if (ids.length <= 1) return ids[0] ?? 'de'
  if (ids.length === 2) return `${ids[0]} or ${ids[1]}`
  return `${ids.slice(0, -1).join(', ')}, or ${ids[ids.length - 1]}`
}

function layoutLabel(root: string, name: string): string {
  try {
    const def = readLayout(path.join(root, 'design'), name)
    return def.purpose ? `${name} — ${def.purpose}` : name
  } catch {
    return name
  }
}

function readDesignFile(root: string, rel: string): string {
  const normalized = rel.replaceAll('\\', '/')
  let file: string
  try {
    file = designFilePath(root, normalized)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read that design file.'
    if (message.startsWith('Design path is not allowed')) fail(`${message}. Use list_design for the files, and read_layout for a layout.`)
    fail(message)
  }
  if (!fs.existsSync(file)) fail(`Missing design/${normalized}.`)
  return fs.readFileSync(file, 'utf8')
}

export function windowText(text: string, offset: number, limit = DESIGN_READ_LIMIT): string {
  const start = Math.min(Math.max(0, Math.trunc(offset)), text.length)
  if (start === 0 && text.length <= limit) return text
  const end = Math.min(text.length, start + limit)
  const shown = text.slice(start, end)
  const note =
    end < text.length
      ? `[Showing characters ${start}–${end} of ${text.length}. Call again with offset ${end} for the rest.]`
      : `[Showing characters ${start}–${end} of ${text.length}. That is the end.]`
  return `${shown}\n\n${note}`
}

function briefLine(rel: string): string {
  const normalized = rel.replaceAll('\\', '/')
  if (normalized === 'styles.css' || normalized === 'shell.njk' || normalized === 'labels.yml' || normalized === 'nav.yml' || normalized === 'tokens.yml') {
    return 'If the shared look changed, rewrite design/brief.md.'
  }
  return ''
}

function textMap(root: string, provided: LanguageText | undefined, label: string): Record<string, string> {
  const site = readSiteConfig(root)
  const value: Record<string, string> =
    typeof provided === 'string' ? { [defaultLanguage(root)]: provided } : { ...(provided ?? {}) }
  const known = new Set(site.languages.map((language) => language.id))
  for (const id of Object.keys(value)) {
    if (!known.has(id)) fail(`${label}: unknown language ${id}. Use ${languageChoice(root)}.`)
  }
  for (const language of site.languages) {
    if (!language.optional && !value[language.id]?.trim()) {
      fail(`${label}: missing ${language.label} text (${language.id}). Send an object with every language that is not optional, such as {"de":"…","en":"…"}.`)
    }
  }
  return value
}

function mergeSlots(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing }
  for (const [name, value] of Object.entries(incoming)) {
    if (value === null) delete merged[name]
    else merged[name] = value
  }
  return merged
}

export function contentTools(root: string, options: ToolOptions = {}): ToolSet {
  return {
    search_content: defineTool('search_content', {
      description:
        'Search pages, events, and places for a literal phrase, not a pattern. Returns matching lines with file paths. Use it to find one file before reading it.',
      input: z.object({ query: z.string().describe('Required. A literal phrase of at least two characters.') }),
      execute: ({ query }) => searchContent(root, query),
    }),
    list_pages: defineTool('list_pages', {
      description: 'List pages. Each line is the slug, the title in the default language, and the date when the page is a news item.',
      input: z.object({}),
      execute: () => pages(root),
    }),
    read_page: defineTool('read_page', {
      description:
        'Read a page: its layout, date, title in every language, and slot values. Before write_page, copy what you do not change from this.',
      input: z.object({ slug: z.string().describe('Required. Page slug.') }),
      execute: ({ slug }) => {
        assertSlug(slug)
        const file = pageFilePath(root, slug)
        if (!fs.existsSync(file)) fail(`Missing page ${slug}`)
        return fs.readFileSync(file, 'utf8')
      },
    }),
    write_page: defineTool('write_page', {
      description:
        'Write a page. Send slug, layout, title, and slots. title is an object keyed by language id, such as {"de":"TRAP","en":"TRAP"}. slots hold the values the layout declares: read_layout names them and their types. Translated text is an object keyed by language id; pictures, links and dates are stored once. Example: {"slug":"trap","layout":"article","title":{"de":"TRAP","en":"TRAP"},"slots":{"body":{"de":"Die Halle ist offen.","en":"The hall is open."}}}. Send every language that is not optional. Slots you send replace those slots; slots you leave out stay; send null to remove one. To change a few words or one value of a page that exists, use edit_slot or set_slot instead. To rewrite slots, read_page first and send only what changes. Layout must already exist. If you change the layout of a page, send slots that fit the new layout and null for the ones it does not have. date marks a news item: omit it to keep the current date, send "" to remove it. A picture in markdown is ![caption](/media/name.jpg). Nothing is written when anything is wrong.',
      input: z.object({
        slug: z.string().describe('Required. Page slug, such as trap.'),
        layout: z.string().describe('Required. Name of a layout that already exists, such as article.'),
        title: languageText.optional().describe('Object of language id to title. Required for a new page. Omit to keep the titles.'),
        slots: z.record(z.string(), z.any()).optional().describe('Slot values by slot name. Omit to keep the slots.'),
        date: z.string().optional().describe('Optional YYYY-MM-DD, only for a news item. Omit to keep the current date. "" removes it.'),
      }),
      execute: ({ slug, layout, title, slots, date }) => {
        assertSlug(slug)
        pageLayoutsOrThrow(root, layout)
        const existing = readPage(root, slug)
        const incoming = title === undefined ? {} : typeof title === 'string' ? { [defaultLanguage(root)]: title } : title
        const merged: PageFile = {
          slug,
          layout,
          date: date === undefined ? existing?.date : date || undefined,
          title: { ...(existing?.title ?? {}), ...incoming },
          slots: mergeSlots(existing?.slots ?? {}, slots ?? {}),
        }
        const problems = checkPage(root, merged)
        if (problems.length > 0) fail(`write_page ${slug}: ${problems.join('; ')}. Nothing was written.`)
        writePage(root, merged)
        const languages = Object.keys(merged.title).join(', ')
        return finish(root, `Wrote page ${slug} (${languages}) with layout ${layout}.`)
      },
    }),
    set_slot: defineTool('set_slot', {
      description:
        'Set one slot, or one place inside a slot, on a page, without sending the whole page. slot is a name such as body, or a path into a list or group such as cards.2.title (a list index counts from 0; the index after the last item adds one). For translated text send lang and a string to change one language, or leave lang out and send an object keyed by language. value null removes it. Use it to replace a value; use edit_slot to change a few words inside text.',
      input: z.object({
        slug: z.string().describe('Required. Page slug.'),
        slot: z.string().describe('Required. Slot name or path, such as body or facts.1.value.'),
        value: z.any().describe('Required. The new value. null removes it.'),
        lang: z.string().optional().describe('Optional. Language id, to set one language of translated text.'),
      }),
      execute: ({ slug, slot, value, lang }) => {
        const page = readPage(root, slug)
        if (!page) fail(`Missing page ${slug}`)
        const def = slotDefAt(readLayout(path.join(root, 'design'), page.layout).slots, slotPath(slot))
        const parts = slotPath(slot)
        let next = value
        if (lang !== undefined) {
          if (!((def.type === 'text' || def.type === 'markdown') && def.translate)) fail(`${slot} is not translated text, so lang does not apply.`)
          if (value !== null && typeof value !== 'string') fail(`With lang, value is the text of that language.`)
          const current = (valueAt(page.slots, parts) ?? {}) as Record<string, string>
          const { [lang]: _removed, ...others } = current
          next = value === null ? others : { ...others, [lang]: value }
          if (value === null && Object.keys(others).length === 0) next = null
        }
        const slots = withValueAt(page.slots, parts, next)
        const problems = checkPage(root, { ...page, slots })
        if (problems.length > 0) fail(`set_slot ${slug}: ${problems.join('; ')}. Nothing was written.`)
        writePage(root, { ...page, slots })
        return finish(root, `Set slots.${slot}${lang ? ` (${lang})` : ''} of page ${slug}.`)
      },
    }),
    edit_slot: defineTool('edit_slot', {
      description:
        'Change a few words inside one text or markdown slot of a page: replace text that appears once in it. find must match exactly once, so include a few words around it; set all to replace every match. For translated text send lang. Use it to fix a word, a number, or a sentence instead of sending the whole page.',
      input: z.object({
        slug: z.string().describe('Required. Page slug.'),
        slot: z.string().describe('Required. Slot name or path, such as body or cards.2.text.'),
        find: z.string().describe('Required. The exact text to replace. Copy it from read_page.'),
        replace: z.string().describe('Required. The new text. May be empty.'),
        lang: z.string().optional().describe('Required for translated text: the language id.'),
        all: z.boolean().optional().describe('Optional. Replace every match instead of requiring one.'),
      }),
      execute: ({ slug, slot, find, replace, lang, all }) => {
        const page = readPage(root, slug)
        if (!page) fail(`Missing page ${slug}`)
        const parts = slotPath(slot)
        const def = slotDefAt(readLayout(path.join(root, 'design'), page.layout).slots, parts)
        if (def.type !== 'text' && def.type !== 'markdown') fail(`${slot} is ${def.type}. edit_slot changes text. Use set_slot.`)
        const language = def.translate ? (lang ?? (readSiteConfig(root).languages.length === 1 ? defaultLanguage(root) : undefined)) : undefined
        if (def.translate && !language) fail(`${slot} is translated. Send lang: ${languageChoice(root)}.`)
        const at = def.translate ? [...parts, language as string] : parts
        const current = valueAt(page.slots, at)
        if (typeof current !== 'string') fail(`Page ${slug} has no text in ${slot}${language ? ` (${language})` : ''}. Use set_slot to write it.`)
        const { text, count } = replaceOnce(current, find, replace, `${slug} ${slot}${language ? ` (${language})` : ''}`, all)
        const slots = withValueAt(page.slots, at, text)
        const problems = checkPage(root, { ...page, slots })
        if (problems.length > 0) fail(`edit_slot ${slug}: ${problems.join('; ')}. Nothing was written.`)
        writePage(root, { ...page, slots })
        return finish(root, `Replaced ${count === 1 ? 'one match' : `${count} matches`} in slots.${slot}${language ? ` (${language})` : ''} of page ${slug}.`)
      },
    }),
    delete_pages: defineTool('delete_pages', {
      description:
        'Remove many pages at once, in every language: name them in slugs, or give source_prefix such as /events/ for every page that import_pages took from that part of the source site. The home page is never removed. Use it to take back part of an import instead of removing pages one by one. They are taken out of the import record, so they can be imported again. Pictures stay.',
      input: z.object({
        slugs: z.array(z.string()).max(300).optional().describe('Optional. Page slugs, at most 300.'),
        source_prefix: z.string().optional().describe('Optional. A part of the source site in the form of an import rule: /events/, /news/*, /events/2021-*.'),
      }),
      execute: (input) => removePages(root, input),
    }),
    delete_page: defineTool('delete_page', {
      description:
        'Remove a page from the draft, in every language. The home page cannot be removed. Navigation links and pictures stay. The public site keeps the page until publish.',
      input: z.object({ slug: z.string().describe('Required. Page slug.') }),
      execute: ({ slug }) => removePage(root, slug),
    }),
    list_events: defineTool('list_events', {
      description: 'List events. Each line is the slug, the title, and each date as start or start–end. Use the slug with read_event before changing an event.',
      input: z.object({}),
      execute: () => {
        const dir = path.join(root, 'content', 'events')
        if (!fs.existsSync(dir)) return []
        const language = defaultLanguage(root)
        return fs
          .readdirSync(dir)
          .filter((name) => name.endsWith('.yml'))
          .map((name) => {
            const slug = name.replace(/\.yml$/, '')
            const event = readYaml<EventDoc>(path.join(dir, name), {
              slug,
              title: {},
              body: {},
              place: '',
              categories: [],
              dates: [],
            })
            const title = event.title[language] || Object.values(event.title)[0] || slug
            const dates = event.dates.map((date) => (date.end ? `${date.start}–${date.end}` : date.start)).join(', ') || 'no dates'
            return `${slug} — ${title} — ${dates}`
          })
      },
    }),
    read_event: defineTool('read_event', {
      description: 'Read one event with its title, body, place, categories, fields, and dates. Call this before write_event when the event exists, then write it back with the same slug.',
      input: z.object({ slug: z.string().describe('Required. Event slug.') }),
      execute: ({ slug }) => readContentYaml(root, 'events', slug, 'event'),
    }),
    write_event: defineTool('write_event', {
      description:
        'Write an event. Send slug, title, body, place, categories, and dates together. title and body are an object keyed by language id with every language that is not optional, such as {"de":"Halle","en":"Hall"}. dates is an array such as [{"start":"2026-05-01T18:00","end":"2026-05-01T21:00"}]. categories is an array of existing option ids, [] when there are none. To change an event, call read_event first, then send the same slug with the parts you do not change as they are. Place must already exist.',
      input: z.object({
        slug: z.string().describe('Required. Event slug. Same slug as read_event when the event exists.'),
        title: languageText.describe('Required. Object of language id to text, such as {"de":"Halle","en":"Hall"}.'),
        body: languageText.describe('Required. Object of language id to markdown.'),
        place: z.string().describe('Required. Slug of a place that already exists.'),
        categories: z.array(z.string()).describe('Required. Existing category option ids. [] when there are none.'),
        dates: z
          .array(
            z.object({
              start: z.string().describe('Required ISO date or datetime, such as 2026-05-01T18:00.'),
              end: z.string().optional().describe('Optional ISO end. Omit for a single moment.'),
            }),
          )
          .describe('Required. Array of {start, end?}.'),
        fields: z.record(z.string(), z.string()).optional().describe('Optional object of field id to an existing option id.'),
      }),
      execute: (input) => {
        assertSlug(input.slug)
        assertSlug(input.place)
        const placeFile = path.join(root, 'content', 'places', `${input.place}.yml`)
        if (!fs.existsSync(placeFile)) fail(`Unknown place ${input.place}`)
        const title = textMap(root, input.title, 'title')
        const body = textMap(root, input.body, 'body')
        const known = readEventFields(root)
        const categories = known.find((field) => field.id === 'categories')
        for (const category of input.categories) {
          if (categories && !categories.options.some((option) => option.id === category)) fail(`Unknown category ${category}`)
        }
        for (const [id, optionId] of Object.entries(input.fields ?? {})) {
          const field = known.find((item) => item.id === id)
          if (!field) fail(`Unknown field ${id}`)
          if (optionId && !field.options.some((option) => option.id === optionId)) fail(`Unknown option ${optionId}`)
        }
        const event: EventDoc = {
          slug: input.slug,
          title,
          body,
          place: input.place,
          categories: input.categories,
          fields: input.fields,
          dates: input.dates,
        }
        writeYaml(path.join(root, 'content', 'events', `${input.slug}.yml`), event)
        return finish(root, `Wrote event ${input.slug} with ${input.dates.length} dates.`)
      },
    }),
    delete_event: defineTool('delete_event', {
      description: 'Remove one event from the draft. The place it names stays. The public site keeps the event until publish.',
      input: z.object({ slug: z.string().describe('Required. Event slug.') }),
      execute: ({ slug }) => removeYaml(root, 'events', slug, 'event'),
    }),
    write_place: defineTool('write_place', {
      description:
        'Write a place. Send slug, name, and onPremises. name is an object keyed by language id with every language that is not optional, such as {"de":"Halle","en":"Hall"}. address is optional.',
      input: z.object({
        slug: z.string().describe('Required. Place slug.'),
        name: languageText.describe('Required. Object of language id to name.'),
        onPremises: z.boolean().describe('Required boolean. True when the place is on the premises.'),
        address: z.string().optional().describe('Optional postal address.'),
      }),
      execute: (input) => {
        assertSlug(input.slug)
        const place: PlaceDoc = {
          slug: input.slug,
          name: textMap(root, input.name, 'name'),
          address: input.address,
          onPremises: input.onPremises,
        }
        writeYaml(path.join(root, 'content', 'places', `${input.slug}.yml`), place)
        return finish(root, `Wrote place ${input.slug}.`)
      },
    }),
    list_places: defineTool('list_places', {
      description: 'List places. Each line is the slug and the name.',
      input: z.object({}),
      execute: () => {
        const dir = path.join(root, 'content', 'places')
        if (!fs.existsSync(dir)) return []
        const language = defaultLanguage(root)
        return fs
          .readdirSync(dir)
          .filter((name) => name.endsWith('.yml'))
          .map((name) => {
            const slug = name.replace(/\.yml$/, '')
            const place = readYaml<PlaceDoc>(path.join(dir, name), { slug, name: {}, onPremises: true })
            const label = place.name[language] || Object.values(place.name)[0] || slug
            return `${slug} — ${label}`
          })
      },
    }),
    read_place: defineTool('read_place', {
      description: 'Read one place with its name, address, and whether it is on the premises.',
      input: z.object({ slug: z.string().describe('Required. Place slug.') }),
      execute: ({ slug }) => readContentYaml(root, 'places', slug, 'place'),
    }),
    delete_place: defineTool('delete_place', {
      description: 'Remove one place from the draft. Events that name it keep that place slug. The public site keeps the place until publish.',
      input: z.object({ slug: z.string().describe('Required. Place slug.') }),
      execute: ({ slug }) => removeYaml(root, 'places', slug, 'place'),
    }),
    list_pictures: defineTool('list_pictures', {
      description: 'Search pictures already stored, by name, German description, or tag. Returns addresses such as /media/hof.webp.',
      input: z.object({ query: z.string().describe('Required. Words to search names, descriptions, and tags. Empty returns only the count.') }),
      execute: ({ query }) => {
        const found = searchPictures(root, query)
        if (!query.trim()) return `There are ${found.total} pictures. Pass words to search names, descriptions, and tags.`
        if (found.matches.length === 0) return `No picture matches ${query}. ${found.total} pictures are stored.`
        const lines = found.matches.map((picture) => {
          const tags = picture.tags.length ? picture.tags.join(', ') : 'no tags'
          return `${picture.address} — ${picture.description || 'no description'} — ${tags}`
        })
        const more = found.matched > found.matches.length ? `\n\nShowing ${found.matches.length} of ${found.matched}. Narrow the query.` : ''
        return `${lines.join('\n')}${more}`
      },
    }),
    save_picture: defineTool('save_picture', {
      description:
        'Download one picture the person named from a public website and store the original. Only for a picture the person owns or may use: say so if you are unsure. Do not download every image on a page. Omit name, description, and tags to have the tool look at the picture and fill a short name, a German description, and tags. An existing file with the same name is kept unless replace is true; set replace only when the person asked to replace that picture. Call fit_picture before you put it on a page.',
      input: z.object({
        url: z.string().describe('Required. Address of the picture.'),
        name: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        replace: z.boolean().optional(),
      }),
      execute: async ({ url, name, description, tags, replace }) => {
        const fetched = await fetchPublicBytes(url, options.fetchPage)
        const kind = detectPicture(fetched.body)
        if (!kind) fail(`Could not save ${url}: that file is not a JPEG, PNG, WebP, GIF, or SVG.`)
        const chosen = {
          name: name?.trim() ?? '',
          description: description?.trim() ?? '',
          tags: tags ?? [],
        }
        if (!chosen.name || !chosen.description || chosen.tags.length === 0) {
          const hint = stemFromFilename(new URL(fetched.url).pathname)
          const suggested = await suggestPicture(fetched.body, kind, hint).catch(() => null)
          if (suggested) {
            if (!chosen.name) chosen.name = suggested.name
            if (!chosen.description) chosen.description = suggested.description
            if (chosen.tags.length === 0) chosen.tags = suggested.tags
          }
          if (!chosen.name) chosen.name = hint
        }
        const saved = storePicture(root, {
          bytes: fetched.body,
          filename: chosen.name,
          description: chosen.description,
          tags: chosen.tags,
          replace: replace === true,
          origin: fetched.url,
        })
        generate(root)
        const tagList = saved.tags.join(', ') || 'none'
        return `Saved ${saved.address}. Description: ${saved.description || 'none'}. Tags: ${tagList}. Call fit_picture with this address and the width the page gives it before you put it on a page.`
      },
    }),
    fit_picture: defineTool('fit_picture', {
      description:
        'Make a WebP copy of a stored picture for the width a page gives it. width is the CSS pixel width of that place, not the file width. The copy is twice that wide and keeps the proportions. A smaller picture, a GIF, or an SVG is left unchanged. An existing copy at that width is reused. Use the returned address on the page. Example: {"file":"/media/hof.jpg","width":480}. Only fit pictures on a page you are writing.',
      input: z.object({
        file: z.string().describe('Required. Stored picture address, such as /media/hof.jpg.'),
        width: z.number().int().positive().max(4096).describe('Required. The width that place gives the picture, in CSS pixels.'),
      }),
      execute: async ({ file, width }) => {
        const fitted = await fitPicture(root, file, width)
        if (fitted.wrote) generate(root)
        return fitted.message
      },
    }),
    read_picture: defineTool('read_picture', {
      description: 'Read one picture by its address or file name: the address, description, tags, and how often content uses it.',
      input: z.object({ file: z.string().describe('Required. Address or file name.') }),
      execute: ({ file }) => {
        const picture = readPicture(root, file)
        const tags = picture.tags.join(', ') || 'no tags'
        const times = picture.usages === 1 ? 'time' : 'times'
        return `${picture.address} — ${picture.description || 'no description'} — ${tags} — used ${picture.usages} ${times}`
      },
    }),
    discard_picture: defineTool('discard_picture', {
      description:
        'Discard one picture you name, by its address or file name. The file leaves the draft even when a page still uses it. Pages keep the address. This is the same discard as the media manager.',
      input: z.object({ file: z.string().describe('Required. Address or file name.') }),
      execute: ({ file }) => {
        const picture = readPicture(root, file)
        discardPicture(root, picture.file)
        return finish(root, `Discarded ${picture.address}.`)
      },
    }),
    set_homepage_news: defineTool('set_homepage_news', {
      description: 'Choose which news items appear on the homepage, in order.',
      input: z.object({ slugs: z.array(z.string()).describe('Required. Slugs of news items. [] shows the latest items.') }),
      execute: ({ slugs }) => {
        for (const slug of slugs) {
          const page = readPage(root, slug)
          if (!page) fail(`Unknown page ${slug}`)
          if (!page.date) fail(`${slug} is not a news item`)
        }
        writeYaml(path.join(root, 'content', 'home.yml'), { news: slugs })
        return finish(root, `Homepage news is now ${slugs.join(', ') || 'the latest items'}.`)
      },
    }),
  }
}

const TEXT_LIMIT = 1500

function layoutPart(root: string, name: string, part: string | undefined): string {
  const files = readLayoutFiles(path.join(root, 'design'), name)
  const blocks: string[] = []
  if (!part || part === 'layout') blocks.push(`# layouts/${name}/layout.yml\n${files.layout.trimEnd()}`)
  if (!part || part === 'template') blocks.push(`# layouts/${name}/template.njk\n${files.template.trimEnd()}`)
  if (!part || part === 'style') blocks.push(`# layouts/${name}/style.css\n${files.style.trimEnd() || '(empty)'}`)
  if (!part) {
    const example = listPageSlugs(root)
      .map((slug) => readPage(root, slug))
      .find((page) => page?.layout === name)
    if (example) {
      const text = fs.readFileSync(pageFilePath(root, example.slug), 'utf8')
      blocks.push(`# Example: page ${example.slug} uses this layout\n${text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n…` : text.trimEnd()}`)
    }
  }
  return blocks.join('\n\n')
}

// What a layout write has to leave true for every page that uses it.
function layoutReport(root: string, name: string, warnings: string[]): string[] {
  const notes = [...warnings]
  const broken = (pagesByLayout(root).get(name) ?? []).flatMap((slug) => {
    const page = readPage(root, slug)
    const problems = page ? checkPage(root, page) : []
    return problems.length > 0 ? [`${slug}: ${problems.join('; ')}`] : []
  })
  if (broken.length > 0) notes.push(`These pages no longer fit the slots: ${broken.join(' | ')}. Fix them with write_page.`)
  return notes
}

function tokensOf(root: string) {
  try {
    return readTokens(root)
  } catch {
    return { colors: {}, fonts: {}, radius: {}, widths: {} }
  }
}

/** What a changed file does that the tokens are there to prevent, that the old text did not. Advice only. */
function designAdvice(root: string, changes: { rel: string; before: string; after: string }[]): string {
  const tokens = tokensOf(root)
  const lines = changes.flatMap(({ rel, before, after }) =>
    newFindings(lintDesign(rel, before, tokens), lintDesign(rel, after, tokens)).map((finding) => `- design/${rel}: ${finding}`),
  )
  return lines.length === 0 ? '' : `\nDesign check (advice, nothing was refused):\n${lines.join('\n')}`
}

type LayoutWrite = { name: string; purpose: string; slots: unknown; template: string; style?: string }

// Check a layout against the guard, write it, and say what else the change affects. A failed build puts the old layout back.
async function saveLayout(root: string, input: LayoutWrite, verifier: Verifier): Promise<string> {
  const designDir = path.join(root, 'design')
  for (const [rel, content] of [
    [`layouts/${input.name}/template.njk`, input.template],
    ...(input.style === undefined ? [] : [[`layouts/${input.name}/style.css`, input.style]]),
  ] as [string, string][]) {
    const refused = guardDesignWrite(root, rel, content)
    if (refused) fail(refused)
    if (rel.endsWith('.css')) {
      const blank = documentOpacityRefusal(content)
      if (blank) fail(blank)
    }
  }
  const before = layoutExists(designDir, input.name) ? readLayoutFiles(designDir, input.name) : null
  const { warnings: layoutWarnings } = writeLayout(designDir, input)
  const defined = new Set(labelNames(root))
  const missing = labelReferences(input.template).filter((name) => !defined.has(name))
  const warnings = missing.length > 0 ? [...layoutWarnings, `Labels ${missing.join(', ')} are not in design/labels.yml, so they show nothing. Add each with a text per language.`] : layoutWarnings
  try {
    const notes = layoutReport(root, input.name, warnings)
    const advice = designAdvice(root, [
      { rel: `layouts/${input.name}/template.njk`, before: before?.template ?? '', after: input.template },
      ...(input.style === undefined ? [] : [{ rel: `layouts/${input.name}/style.css`, before: before?.style ?? '', after: input.style }]),
    ])
    const summary = `${before ? 'Updated' : 'Wrote'} layout ${input.name}.${notes.length > 0 ? `\n${notes.join('\n')}` : ''}${advice}`
    return await finishDesign(root, `${summary}\n${briefLine('styles.css')}`.trimEnd(), verifier, input.name)
  } catch (error) {
    restoreLayout(designDir, input.name, before)
    throw error
  }
}

// Check a design file against the guard and write it. A failed build puts the old file back.
async function saveDesignFile(root: string, rel: string, content: string, verifier: Verifier): Promise<string> {
  const target = rel.trim().replaceAll('\\', '/')
  if (!target) fail('path is required, such as styles.css. Nothing was written.')
  const layoutFile = /^layouts\/([a-z0-9-]+)\/(layout\.yml|template\.njk|style\.css)$/.exec(target)
  if (layoutFile?.[2] === 'layout.yml') fail('Write a layout’s slots and purpose with write_layout or edit_layout. Nothing was written.')
  if (layoutFile && !layoutExists(path.join(root, 'design'), layoutFile[1])) fail(`Unknown layout ${layoutFile[1]}. Use write_layout to create it.`)
  const refused = guardDesignWrite(root, target, content)
  if (refused) fail(refused)
  if (target.endsWith('.css')) {
    const blank = documentOpacityRefusal(content)
    if (blank) fail(blank)
  }
  if (layoutFile?.[2] === 'template.njk') {
    const checked = checkLayout(readLayout(path.join(root, 'design'), layoutFile[1]), content)
    if (checked.errors.length > 0) fail(`${checked.errors.join('. ')}. Nothing was written.`)
  }
  if (target === 'labels.yml') parseLabels(content)
  if (target === 'fonts.yml') parseFonts(content)
  let tokenNote = ''
  if (target === 'tokens.yml') {
    const tokens = parseTokens(content)
    const warnings = [...contrastWarnings(tokens), ...tokenFontsWithoutFiles(root, tokens.fonts)]
    if (warnings.length > 0) tokenNote = `\nToken check (advice): ${warnings.join(' ')}`
  }
  const file = designFilePath(root, target)
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  fs.writeFileSync(file, content)
  try {
    const advice = designAdvice(root, [{ rel: target, before: original, after: content }])
    return await finishDesign(root, `Updated design/${target}. Every page was regenerated. ${briefLine(target)}${tokenNote}${advice}`.trim(), verifier, layoutFile?.[1])
  } catch (error) {
    if (original) fs.writeFileSync(file, original)
    else fs.rmSync(file, { force: true })
    throw error
  }
}

export type ToolOptions = {
  vision?: boolean
  screenshots?: ScreenshotStore
  verifier?: Verifier
  /** Where what a site said is kept for a few hours. None keeps nothing. */
  cacheDir?: string
  /** How a public site is reached. The default only reaches public addresses. */
  fetchPage?: FetchPage
}

export function designTools(root: string, options: ToolOptions = {}): ToolSet {
  const verifier = options.verifier ?? createVerifier()
  const screenshots = options.screenshots ?? new ScreenshotStore()
  return {
    list_design: defineTool('list_design', {
      description: 'List the design files. Layouts are listed by list_layouts.',
      input: z.object({}),
      execute: () => ({
        files: ['brief.md', 'tokens.yml', 'fonts.yml', 'rules.md', 'styles.css', 'shell.njk', 'nav.yml', 'labels.yml', 'categories.yml', 'fields.yml', 'site.yml'],
        layouts: listLayoutNames(path.join(root, 'design')).map((name) => layoutLabel(root, name)),
        references: listReferences(root).map((item) => item.host),
      }),
    }),
    list_layouts: defineTool('list_layouts', {
      description:
        'List every layout with what it is for, the slots it takes, and the pages that use it. Look here before you write a layout: reuse one that fits, or fork the closest one.',
      input: z.object({}),
      execute: () => formatCatalog(layoutCatalog(path.join(root, 'design'), pagesByLayout(root))),
    }),
    read_layout: defineTool('read_layout', {
      description:
        'Read a layout: layout.yml (purpose and slots), template.njk, style.css, and one page that uses it as an example of slot values. part limits it to one file.',
      input: z.object({
        name: z.string().describe('Required. Layout name.'),
        part: z.enum(['layout', 'template', 'style']).optional().describe('Optional. Only that file.'),
      }),
      execute: ({ name, part }) => {
        if (!layoutExists(path.join(root, 'design'), name)) fail(`Unknown layout ${name}. Use list_layouts.`)
        return windowText(layoutPart(root, name, part), 0, DESIGN_READ_LIMIT)
      },
    }),
    write_layout: defineTool('write_layout', {
      description:
        'Write a layout, all of it at once: name, purpose, slots, template, and style. For a small change to a layout that exists, use edit_layout. A layout may be for one page. Use list_layouts first. A layout is a page shape, so it never holds one page’s words: text comes from slots, and short interface text from labels in design/labels.yml. slots is an object of slot names to a type: text, markdown, image, link, date, list, or group. Text and markdown hold one entry per language; the others are stored once. Write a slot as "text", or as {"type":"text","required":true,"translate":false}. A list has "of", the type of one item, and a group has "fields". Example slots: {"lede":"text","body":{"type":"markdown","required":true},"photo":"image","facts":{"type":"list","of":{"label":"text","value":{"type":"text","translate":false}}}}. title, date and layout are page fields, not slots. The template extends shell.njk and shows slots with {{ slots.name }} (markdown is already HTML); title, date, labels, news, upcoming, and lang are also available. style is CSS for this layout only and may use Tailwind classes: it applies to pages with this layout and nothing else. Every slot must be shown in the template, and the template may only read declared slots. Nothing is written when anything is wrong.',
      input: z.object({
        name: z.string().describe('Required. Lowercase words with dashes, such as room-wide.'),
        purpose: z.string().describe('Required. One line: what pages this layout is for.'),
        slots: z.record(z.string(), z.any()).describe('Required. Slot names to types. {} for a layout with no slots.'),
        template: z.string().describe('Required. The full template.njk.'),
        style: z.string().optional().describe('Optional. The full style.css for this layout. Omit to keep the current one.'),
      }),
      execute: (input) => saveLayout(root, input, verifier),
    }),
    fork_layout: defineTool('fork_layout', {
      description: 'Copy a layout under a new name, with its slots, template, and style. Then change the copy with write_layout. Use it when a page needs something close to an existing layout.',
      input: z.object({
        from: z.string().describe('Required. Layout to copy.'),
        to: z.string().describe('Required. New layout name.'),
      }),
      execute: ({ from, to }) => {
        forkLayout(path.join(root, 'design'), from, to)
        return finish(root, `Forked layout ${from} to ${to}. Change it with write_layout, then point a page at it.`)
      },
    }),
    delete_layout: defineTool('delete_layout', {
      description: 'Remove a layout that no page uses. If pages use it, use replace_layout.',
      input: z.object({ name: z.string().describe('Required. Layout name.') }),
      execute: ({ name }) => {
        const used = pagesByLayout(root).get(name) ?? []
        if (used.length > 0) fail(`Layout ${name} is used by ${used.join(', ')}. Use replace_layout to move those pages first.`)
        removeLayoutFolder(path.join(root, 'design'), name)
        return finish(root, `Removed layout ${name}.`)
      },
    }),
    check_design: defineTool('check_design', {
      description:
        'Review the whole design against the tokens and the catalog: files that use a raw color, a font that is not a token, a default palette color, or an inline style; token colors that read badly together; layouts nobody uses; layouts that take exactly the same slots. It is advice: change what is worth changing. Takes no input.',
      input: z.object({}),
      execute: () => {
        const designDir = path.join(root, 'design')
        const tokens = tokensOf(root)
        const files = [
          'shell.njk',
          'styles.css',
          ...listLayoutNames(designDir).flatMap((name) => [`layouts/${name}/template.njk`, `layouts/${name}/style.css`]),
        ]
        const lines: string[] = [...contrastWarnings(tokens), ...tokenFontsWithoutFiles(root, tokens.fonts)].map((warning) => `- tokens.yml: ${warning}`)
        for (const rel of files) {
          const file = path.join(designDir, rel)
          if (!fs.existsSync(file)) continue
          for (const finding of lintDesign(rel, fs.readFileSync(file, 'utf8'), tokens)) lines.push(`- design/${rel}: ${finding}`)
        }
        for (const entry of layoutCatalog(designDir, pagesByLayout(root))) {
          if (entry.kind !== 'page') continue
          if (entry.pages.length === 0) lines.push(`- layout ${entry.name} is used by no page. Delete it if it is not needed.`)
          if (entry.similar.length > 0) lines.push(`- layouts ${entry.name} and ${entry.similar.join(', ')} take the same slots. One may be enough.`)
        }
        const rawAssets = readYaml<{ assets?: Record<string, unknown> }>(path.join(designDir, 'site.yml'), {}).assets
        if (rawAssets && typeof rawAssets === 'object') for (const problem of assetProblems(root, rawAssets)) lines.push(`- design/site.yml ${problem}`)
        if (Object.keys(tokens.colors).length === 0) lines.push('- design/tokens.yml has no colors, so colors are not checked.')
        return lines.length === 0 ? 'The design follows the tokens. Nothing to change.' : `${lines.slice(0, 24).join('\n')}${lines.length > 24 ? `\n… and ${lines.length - 24} more.` : ''}`
      },
    }),
    add_rule: defineTool('add_rule', {
      description:
        'Keep a lasting preference of the person as a rule for the whole site, one short line, such as “Buttons are always square.” or “No full-bleed photos.” Call it when they say always, never, or I do not like, about how the site should look. The rules are listed in the system prompt, and later chats follow them. A rule that is already there is not added twice.',
      input: z.object({ rule: z.string().describe('Required. One short line, under 180 characters.') }),
      execute: ({ rule }) => {
        const { rules, added } = addRule(root, rule)
        return added ? `Added a rule. There are ${rules.length}: ${rules.join(' | ')}` : 'That rule is already there.'
      },
    }),
    set_asset: defineTool('set_asset', {
      description:
        'Give the whole site a picture by name: logo, favicon, social (the picture shown when a page is shared), or any other such as hero-pattern. Save the picture first with save_picture (and fit_picture for a logo, which needs twice its width on a screen). Templates show it with {{ assets.logo }} and styles with var(--asset-logo), so a design file never holds an address. The starter header shows assets.logo in place of the site name when it is set, and the generator adds favicon and social to every page. Leave picture out to remove one.',
      input: z.object({
        name: z.string().describe('Required. Lowercase words with dashes: logo, favicon, social, hero-pattern.'),
        picture: z.string().optional().describe('Optional. The address of a picture in the site, such as /media/logo-320.webp. Leave it out to remove the asset.'),
      }),
      execute: async ({ name, picture }) => {
        const file = path.join(root, 'design', 'site.yml')
        const site = readYaml<Record<string, unknown>>(file, {})
        const assets: Record<string, unknown> = { ...(site.assets && typeof site.assets === 'object' ? (site.assets as Record<string, unknown>) : {}) }
        if (!picture?.trim()) {
          if (!(name in assets)) fail(`There is no asset ${name}. The site has: ${Object.keys(assets).join(', ') || 'none'}.`)
          delete assets[name]
        } else {
          const problems = assetProblems(root, { [name]: picture.trim() })
          if (problems.length > 0) fail(problems.join(' '))
          assets[name] = picture.trim()
        }
        if (Object.keys(assets).length > 0) site.assets = assets
        else delete site.assets
        writeYaml(file, site)
        const used = picture?.trim() ? `Set asset ${name} to ${picture.trim()}. Show it with {{ assets.${name} }} in a template or var(--asset-${name}) in a style.` : `Removed asset ${name}.`
        return await finishDesign(root, used, verifier)
      },
    }),
    add_font: defineTool('add_font', {
      description:
        'Add a font family to the site, as files in the site. It downloads an open-licence family (from the Fontsource catalog) once, here on the server, so a visitor never contacts anyone else, which the law needs. Use it when a design calls for a font the site does not have. weights default to 400 and 700. subsets default to latin, which covers German; add latin-ext for Polish, Czech or Turkish. as names the font token to set to this family (sans, serif, or another name), so classes like font-serif use it. The starter has Source Sans 3 and Source Serif 4.',
      input: z.object({
        family: z.string().describe('Required. The family name, such as Lora or Source Sans 3.'),
        weights: z.array(z.number().int()).optional().describe('Optional. Weights such as [400, 700]. Each file is about 20 KB, so ask for what is used.'),
        italic: z.boolean().optional().describe('Optional. Also the italic of each weight.'),
        subsets: z.array(z.string()).optional().describe('Optional. Default ["latin"].'),
        as: z.string().optional().describe('Optional. The font token to set: sans, serif, or another name.'),
        preload: z.boolean().optional().describe('Optional. Preload the regular weight, which is on the first screen. Default true.'),
      }),
      execute: async (input) => finish(root, await addFont(root, input, options.fetchPage)),
    }),
    replace_layout: defineTool('replace_layout', {
      description:
        'Remove a layout and point every page that used it at another layout. The pages keep their slot values, so the other layout has to take the same slots; write_page fixes any that do not fit.',
      input: z.object({
        from: z.string().describe('Required. Layout to remove.'),
        to: z.string().describe('Required. Layout that stays.'),
      }),
      execute: async ({ from, to }) => {
        const updated = replaceLayout(root, from, to)
        const problems = updated.flatMap((slug) => {
          const page = readPage(root, slug)
          const found = page ? checkPage(root, page) : []
          return found.length > 0 ? [`${slug}: ${found.join('; ')}`] : []
        })
        const note = problems.length > 0 ? `\nThese pages do not fit ${to} yet: ${problems.join(' | ')}. Fix them with write_page.` : ''
        return await finishDesign(root, `Moved ${updated.join(', ') || 'no pages'} from ${from} to ${to}.${note}`, verifier, to)
      },
    }),
    read_design: defineTool('read_design', {
      description:
        'Read a design file. Path is relative to design/, for example styles.css or shell.njk. Read a layout with read_layout. A file longer than 24000 characters comes back in pieces; the reply names the offset to continue from.',
      input: z.object({
        path: z.string().describe('Required. Path relative to design/, such as styles.css.'),
        offset: z.number().int().min(0).optional().describe('Optional character offset to continue a long file.'),
      }),
      execute: ({ path: rel, offset }) => windowText(readDesignFile(root, rel), offset ?? 0),
    }),
    write_design: defineTool('write_design', {
      description:
        'Overwrite a design file with the full new content: brief.md, tokens.yml, fonts.yml, rules.md, styles.css, shell.njk, nav.yml, labels.yml, categories.yml, fields.yml, or site.yml. Write a layout with write_layout. For a small change, use edit_design. This restyles every page. The shell and styles must not name one page, hold a picture address, or hold words: interface text goes in labels.yml. A stylesheet that sets opacity 0 on html or body is refused.',
      input: z.object({
        path: z.string().describe('Required. Path relative to design/, such as styles.css.'),
        content: z.string().min(1).describe('Required. The full new content of the file.'),
      }),
      execute: ({ path: rel, content }) => saveDesignFile(root, rel, content, verifier),
    }),
    edit_layout: defineTool('edit_layout', {
      description:
        'Change part of a layout: replace one piece of text in its template, its style, or its layout.yml (purpose and slots). find must match exactly once, so include a few words around it; set all to replace every match. Use this for a small change instead of write_layout, which sends the whole layout again. The same checks as write_layout apply.',
      input: z.object({
        name: z.string().describe('Required. Layout name.'),
        part: z.enum(['template', 'style', 'layout']).describe('Required. Which file: template.njk, style.css, or layout.yml.'),
        find: z.string().describe('Required. The exact text to replace. Copy it from read_layout.'),
        replace: z.string().describe('Required. The new text. May be empty to delete the found text.'),
        all: z.boolean().optional().describe('Optional. Replace every match instead of requiring one.'),
      }),
      execute: async ({ name, part, find, replace, all }) => {
        const designDir = path.join(root, 'design')
        if (!layoutExists(designDir, name)) fail(`Unknown layout ${name}. Use list_layouts.`)
        const files = readLayoutFiles(designDir, name)
        const file = part === 'layout' ? 'layout.yml' : part === 'template' ? 'template.njk' : 'style.css'
        const source = part === 'layout' ? files.layout : part === 'template' ? files.template : files.style
        const { text, count } = replaceOnce(source, find, replace, `layouts/${name}/${file}`, all)
        const current = parseLayoutFile(files.layout)
        const next = part === 'layout' ? parseLayoutFile(text) : current
        const saved = await saveLayout(
          root,
          {
            name,
            purpose: next.purpose,
            slots: next.slots,
            template: part === 'template' ? text : files.template,
            style: part === 'style' ? text : files.style,
          },
          verifier,
        )
        return `Replaced ${count === 1 ? 'one match' : `${count} matches`} in layouts/${name}/${file}. ${saved}`
      },
    }),
    edit_design: defineTool('edit_design', {
      description:
        'Change part of a design file: replace one piece of text in styles.css, shell.njk, nav.yml, labels.yml, brief.md, or a layout’s template.njk or style.css. find must match exactly once, so include a few words around it; set all to replace every match. Use this for a small change instead of write_design, which sends the whole file again. The same checks as write_design apply.',
      input: z.object({
        path: z.string().describe('Required. Path relative to design/, such as styles.css.'),
        find: z.string().describe('Required. The exact text to replace. Copy it from read_design.'),
        replace: z.string().describe('Required. The new text. May be empty to delete the found text.'),
        all: z.boolean().optional().describe('Optional. Replace every match instead of requiring one.'),
      }),
      execute: async ({ path: rel, find, replace, all }) => {
        const target = rel.trim().replaceAll('\\', '/')
        const { text, count } = replaceOnce(readDesignFile(root, target), find, replace, `design/${target}`, all)
        return `Replaced ${count === 1 ? 'one match' : `${count} matches`} in design/${target}. ${await saveDesignFile(root, target, text, verifier)}`
      },
    }),
    ...(browserConfigured()
      ? {
          check_page: defineTool('check_page', {
            description:
              'Open a page of the draft in a browser and list what is wrong with how it looks: text that is hard to read, a page that scrolls sideways, pictures that did not load, words that are not visible, an invisible page, script errors. Checks phone width (375px) and desktop width (1280px) unless you choose one. Call it for a page you changed before you finish. page is a slug such as home, or an address such as /kalender/.',
            input: z.object({
              page: z.string().describe('Required. A page slug such as home, or an address such as /kalender/.'),
              lang: z.string().optional().describe('Optional. Language id. Default is the first language.'),
              viewport: z.enum(['mobile', 'desktop', 'both']).optional().describe('Optional. Default both.'),
            }),
            execute: async ({ page, lang, viewport }) => {
              const urlPath = pagePath(root, page, lang)
              const views: ViewportName[] = viewport === 'mobile' ? ['mobile'] : viewport === 'desktop' ? ['desktop'] : ['mobile', 'desktop']
              const expectations = slotExpectations(root)
              const audits = await Promise.all(views.map((view) => auditPage(root, urlPath, view, { expectations })))
              const lines = audits.flatMap((audit) => audit.findings.map((finding) => `- ${audit.viewport}: ${finding}`))
              return lines.length === 0 ? `No problems found on ${urlPath} at ${views.join(' and ')} width.` : `Problems on ${urlPath}:\n${lines.join('\n')}`
            },
          }),
        }
      : {}),
    ...(browserConfigured() && options.vision
      ? {
          preview_page: defineTool('preview_page', {
            description:
              'Look at a page of the draft: you get a picture of it, taken in a browser. Use it to judge how a page looks, such as layout, spacing and balance, after a design change or when asked to match a reference. The picture is shown to you once, in the next step, then dropped, so say what you see. page is a slug such as home, or an address such as /kalender/.',
            input: z.object({
              page: z.string().describe('Required. A page slug such as home, or an address such as /kalender/.'),
              lang: z.string().optional().describe('Optional. Language id. Default is the first language.'),
              viewport: z.enum(['mobile', 'desktop']).optional().describe('Optional. Default desktop.'),
              full: z.boolean().optional().describe('Optional. The whole page, to 2400px tall, instead of the first screen.'),
            }),
            execute: async ({ page, lang, viewport, full }) => {
              const urlPath = pagePath(root, page, lang)
              const view: ViewportName = viewport ?? 'desktop'
              const audit = await auditPage(root, urlPath, view, { screenshot: full ? 'full' : 'viewport', expectations: slotExpectations(root) })
              if (!audit.screenshot) fail('The browser did not return a picture.')
              const id = screenshots.add(audit.screenshot)
              const problems = audit.findings.length > 0 ? ` Problems: ${audit.findings.join(' ')}` : ''
              return `Picture of ${urlPath} at ${view} width${full ? ', whole page' : ''}. ${screenshotMarker(id)}${problems}`
            },
          }),
        }
      : {}),
    site_map: defineTool('site_map', {
      description:
        'List the pages of a public website: the links on its front page to the same site, with their words, and the pages in its sitemap, grouped when there are many. Use it to choose which pages to read.',
      input: z.object({ url: z.string().describe('Required. Address of the site or of a page of it.') }),
      execute: ({ url }) => cached(options.cacheDir, `site_map ${url}`, () => siteMap(url, options.fetchPage)),
    }),
    ...(browserConfigured()
      ? {
          inspect_website: defineTool('inspect_website', {
            description:
              'Open a public page in a browser and describe how it looks: colors by role (page, text, headings, links, header, footer, buttons), fonts and sizes, corners and shadows, menu, and the sections from top to bottom with their colors and sizes. Use it for a site whose design the person likes or wants matched. It does not give the page’s words: use read_page_text for those. Keep a site the person likes with save_reference.',
            input: z.object({
              url: z.string().describe('Required. Address of the page.'),
              view: z.enum(['desktop', 'mobile']).optional().describe('Optional. Default desktop.'),
            }),
            execute: async ({ url, view }) => {
              const viewport: SiteViewport = view ?? 'desktop'
              const wantsPicture = options.vision === true
              const look = async () =>
                withSitePage(url, { viewport, fetchPage: options.fetchPage }, async (page, final) => {
                  const raw = (await page.evaluate(PROFILE_SOURCE)) as RawProfile
                  const text = formatProfile(final, raw, SITE_VIEWPORTS[viewport].height)
                  if (!wantsPicture) return { text, picture: undefined }
                  const height = Math.min(2400, Number(await page.evaluate('document.documentElement.scrollHeight')))
                  const picture = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: true, clip: { x: 0, y: 0, width: SITE_VIEWPORTS[viewport].width, height } })
                  return { text, picture }
                })
              const result = wantsPicture ? await look() : { text: await cached(options.cacheDir, `inspect ${viewport} ${url}`, async () => (await look()).text), picture: undefined }
              const marker = result.picture ? ` ${screenshotMarker(screenshots.add(result.picture))}` : ''
              return `${result.text}${marker}`
            },
          }),
          read_page_text: defineTool('read_page_text', {
            description:
              'Open a public page in a browser and read its text as markdown: headings, paragraphs, lists, links with their addresses, and pictures with their addresses. Menus, headers and footers are left out. Email addresses that the page hides from robots are decoded. A long page comes back in pieces; the reply names the offset to continue from.',
            input: z.object({
              url: z.string().describe('Required. Address of the page.'),
              offset: z.number().int().min(0).optional().describe('Optional character offset to continue a long page.'),
            }),
            execute: async ({ url, offset }) => {
              const text = await cached(options.cacheDir, `text ${url}`, () =>
                withSitePage(url, { fetchPage: options.fetchPage }, async (page, final) => formatText(final, (await page.evaluate(TEXT_SOURCE)) as RawText)),
              )
              return windowText(text, offset ?? 0, 14_000)
            },
          }),
          import_pages: defineTool('import_pages', {
            description:
              'Take the pages of a source site into this site by rule, a batch at a time: it reads each page in a browser, saves the pictures the page uses, writes the page, and points links between imported pages at the new pages. Only for a source site the person named for this, and only for the texts and pictures they said to take. Leave parts out with exclude (for example the events, when they were not asked for) instead of listing every page you want. Read two or three pages of each kind first, then give rules: the first rule whose match fits a page decides its layout. match is "/news/" or "/news/*" for everything under that path, "/about" for one page, "/events/2021-*" for a pattern, "*" for the rest. A page that is only another address (a redirect) of a page is not imported twice. body names the markdown slot for the text (default body), summary a text slot for the first paragraph, lead an image slot for the first picture, dated is for news items. The page title comes from the first heading. Pages in a language the site has (a /en/ prefix) join the page of the same address; nothing is translated. Pass skip with the source addresses you already wrote in the first pass. A call reads pages, five at a time, for about a minute and does as many as that allows; when the result says more pages match, call again with the same rules. Pages already imported are left alone unless refresh is true. The result lists what did not fit. Example: {"source":"https://old.example","rules":[{"match":"/news/","layout":"article","dated":true},{"match":"*","layout":"article"}],"skip":["/contact"]}.',
            input: z.object({
              source: z.string().describe('Required. Address of the source site.'),
              rules: z
                .array(
                  z.object({
                    match: z.string().describe('Required. A path such as /news/ or /about, or *.'),
                    layout: z.string().describe('Required. A layout that already exists.'),
                    body: z.string().optional().describe('Optional. The markdown slot for the text. Default body.'),
                    summary: z.string().optional().describe('Optional. A text slot for the first paragraph.'),
                    lead: z.string().optional().describe('Optional. An image slot for the first picture.'),
                    dated: z.boolean().optional().describe('Optional. Keep the day the page was published.'),
                  }),
                )
                .min(1)
                .max(40)
                .describe('Required. The rules, most specific first.'),
              exclude: z.array(z.string()).max(60).optional().describe('Optional. Addresses to leave out, as in a rule: /events/*, /blog, /category/*, /events/2021-*. Checked before the rules, so a * rule can stay.'),
              skip: z.array(z.string()).optional().describe('Optional. Source addresses already used in the first pass.'),
              limit: z.number().int().min(1).max(MAX_BATCH).optional().describe(`Optional. Pages in this call. Default ${DEFAULT_BATCH}.`),
              refresh: z.boolean().optional().describe('Optional. Read imported pages again and overwrite them. Only when the person asks.'),
            }),
            execute: async (input) => {
              const summary = await importPages(root, input, {
                listPaths: (source) => collectPaths(source, options.fetchPage),
                readPage: (url) =>
                  withSitePage(url, { fetchPage: options.fetchPage }, async (page, final) => {
                    const raw = (await page.evaluate(TEXT_SOURCE)) as RawText
                    if (raw.empty || !raw.markdown.trim()) throw new Error(`${url} shows no text to read.`)
                    const date = String(await page.evaluate(DATE_SOURCE).catch(() => ''))
                    return { title: raw.title, markdown: raw.markdown, date, finalUrl: final }
                  }),
                fetchPicture: (url) => fetchPublicBytes(url, options.fetchPage),
                knownPicture: (url) => pictureByOrigin(root, url),
              })
              return finish(root, summary)
            },
          }),
          copy_menu: defineTool('copy_menu', {
            description:
              'Give this site the menu of a source site, as the person asked: its main entries and their sub-entries in the same order, each pointing at the page of this site that the source page became (see import_pages) or at a page named after it. Source pages that this site has no page for are left out and listed. An entry that leads to another site stays an outbound link. Labels in a second language are taken from the source only when its menu there has the same shape; nothing is translated. Call it after the pages are written or imported. It replaces the menu in design/nav.yml and keeps the footer.',
            input: z.object({ source: z.string().describe('Required. Address of the source site.') }),
            execute: async ({ source }) => {
              const site = readSiteConfig(root)
              const languages = site.languages.map((language) => language.id)
              const origin = new URL(/^https?:\/\//i.test(source.trim()) ? source.trim() : `https://${source.trim()}`).origin
              const menus: Record<string, MenuEntry[]> = {}
              for (const lang of languages) {
                const home = lang === languages[0] ? `${origin}/` : `${origin}/${lang}/`
                try {
                  menus[lang] = await withSitePage(home, { fetchPage: options.fetchPage }, async (page) => (await page.evaluate(MENU_SOURCE)) as MenuEntry[])
                } catch (error) {
                  if (lang === languages[0]) throw error
                }
              }
              if (!menus[languages[0]]?.length) fail(`No menu was found on ${origin}/. Name the pages in design/nav.yml yourself.`)
              // A menu entry may lead through a redirect (a /home/ address) to the page that was imported: follow it for the entries that found no page.
              const direct = resolverFor(root)
              const redirected = new Map<string, string>()
              const unresolved = new Set<string>()
              for (const menu of Object.values(menus)) {
                for (const entry of menu) {
                  for (const item of [entry, ...entry.children]) {
                    try {
                      const url = new URL(item.href)
                      if (url.origin === origin && !direct(normalPath(url.pathname), item.label)) unresolved.add(url.href)
                    } catch {
                      // Not an address; buildNav leaves it out.
                    }
                  }
                }
              }
              for (const href of [...unresolved].slice(0, 80)) {
                const ended = await resolveAddress(options.fetchPage ?? safeFetch, href)
                if ('url' in ended) redirected.set(normalPath(new URL(href).pathname), normalPath(new URL(ended.url).pathname))
              }
              const resolve = (address: string, label?: string) => direct(address, label) ?? (redirected.has(address) ? direct(redirected.get(address) as string, label) : null)
              const built = buildNav(menus, { origin, languages, resolve })
              if (built.menu.length === 0) fail('None of its menu entries has a page on this site yet. Write or import the pages first.')
              writeMenu(root, built.menu)
              const lines = built.menu.map((item) => `- ${item.label[languages[0]]} → ${item.href}${item.children ? ` (${item.children.map((child) => child.label[languages[0]]).join(', ')})` : ''}`)
              const notes = [
                built.left.length > 0 ? `Left out, no page on this site: ${built.left.slice(0, 20).join('; ')}${built.left.length > 20 ? `; and ${built.left.length - 20} more` : ''}.` : '',
                built.copied.length > 0 ? `The source has no menu of the same shape in ${built.copied.join(', ')}, so those labels are the ${languages[0]} ones. Write them in that language with edit_design if the person wants.` : '',
              ].filter(Boolean)
              return finish(root, [`The menu now follows ${origin}:`, ...lines, ...notes].join('\n'))
            },
          }),
          save_reference: defineTool('save_reference', {
            description:
              'Keep a site the person likes as a reference: how it looks, and what they like about it, in design/references. Later chats read it with read_reference to match that look. Call it after inspect_website when the person says they like the site or want something like it.',
            input: z.object({
              url: z.string().describe('Required. Address of the page that was inspected.'),
              note: z.string().min(3).describe('Required. What the person likes about it, in their words, and which parts to copy or leave.'),
            }),
            execute: async ({ url, note }) => {
              const profile = await cached(options.cacheDir, `inspect desktop ${url}`, () =>
                withSitePage(url, { fetchPage: options.fetchPage }, async (page, final) => formatProfile(final, (await page.evaluate(PROFILE_SOURCE)) as RawProfile)),
              )
              const host = saveReference(root, { url, note, profile })
              return finish(root, `Saved design/references/${host}.md.`)
            },
          }),
        }
      : {
          read_website: defineTool('read_website', {
            description:
              'Read one public page. Returns its HTML with scripts and style blocks removed, absolute addresses, one address per picture, mailto links for protected addresses, and a short colors-and-fonts note. A long page is cut and says so. Call it again for each further page.',
            input: z.object({ url: z.string().describe('Required. Address of the page.') }),
            execute: ({ url }) => readWebsite(url, options.fetchPage),
          }),
        }),
    read_reference: defineTool('read_reference', {
      description: 'Read a saved reference: a site the person likes, how it looks, and what they like about it. The references are listed in the system prompt.',
      input: z.object({ site: z.string().describe('Required. The site name, such as schlor.org.') }),
      execute: ({ site }) => readReference(root, site),
    }),
  }
}

function restoreLayout(designDir: string, name: string, before: { layout: string; template: string; style: string } | null): void {
  const folder = path.join(designDir, 'layouts', name)
  if (!before) {
    fs.rmSync(folder, { recursive: true, force: true })
    return
  }
  fs.writeFileSync(path.join(folder, 'layout.yml'), before.layout)
  fs.writeFileSync(path.join(folder, 'template.njk'), before.template)
  fs.writeFileSync(path.join(folder, 'style.css'), before.style)
}

export function setupTools(root: string): ToolSet {
  return {
    propose_setup: defineTool('propose_setup', {
      description: 'Record a setup proposal, or part of one, without writing it onto the site. Each call adds the parts it carries to what is recorded, and a part sent again replaces the earlier one, so a long proposal goes in several calls. The person accepts it before it is applied.',
      input: z.object({ proposal: z.record(z.string(), z.unknown()).describe('Required. The proposal.') }),
      execute: ({ proposal }) => {
        const problems = recordProposal(root, proposal as SetupProposal)
        if (problems.length === 0) return 'Recorded the proposal. It is not on the site until it is accepted.'
        return `Recorded the proposal, but it cannot be accepted as it is. Fix this with the next propose_setup call:\n- ${problems.join('\n- ')}`
      },
    }),
    accept_setup: defineTool('accept_setup', {
      description:
        'Write an accepted setup decision onto the site. Pass the decision in proposal. Set useRecorded when the person accepts the recorded proposal. Set finish when setup is done. A directive that already names a decision is acceptance for that decision: pass it and leave finish false.',
      input: z.object({
        proposal: z.record(z.string(), z.unknown()).optional(),
        useRecorded: z.boolean().optional(),
        finish: z.boolean().optional(),
      }),
      execute: ({ proposal, useRecorded, finish: done }) => {
        const recorded = useRecorded ? readProposal(root) : {}
        const notes = applyProposal(root, { ...recorded, ...(proposal ?? {}) } as SetupProposal, done === true)
        return finish(root, `Accepted ${notes}.`)
      },
    }),
  }
}

export function toolsFor(mode: EditorMode, root: string, options: ToolOptions = {}): ToolSet {
  const edit = { ...contentTools(root, options), ...designTools(root, options) }
  return mode === 'setup' ? { ...edit, ...setupTools(root) } : edit
}
