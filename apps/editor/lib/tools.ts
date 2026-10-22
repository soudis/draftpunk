import fs from 'node:fs'
import path from 'node:path'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import { searchContent } from './content-search'
import { guardDesignWrite } from './layout-guard'
import type { EditorMode } from './mode'
import { documentOpacityRefusal } from './page-opacity'
import { suggestPicture } from './picture-vision'
import { detectPicture, discardPicture, fitPicture, readPicture, searchPictures, stemFromFilename, storePicture } from './pictures'
import { fetchPublicBytes, readWebsite } from './read-website'
import { defineTool, fail } from './tool-kit'
import {
  assertSlug,
  applyProposal,
  checkLayout,
  checkPage,
  deletePage,
  designFilePath,
  forkLayout,
  formatCatalog,
  generate,
  layoutCatalog,
  layoutExists,
  listLayoutNames,
  listPageSlugs,
  lostContent,
  pageFilePath,
  pageLayoutsOrThrow,
  pagesByLayout,
  readEventFields,
  readLayout,
  readLayoutFiles,
  readPage,
  readProposal,
  readYaml,
  readSiteConfig,
  recordProposal,
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

function removePage(root: string, slug: string): string {
  if (slug === 'home') fail('The home page cannot be removed.')
  assertSlug(slug)
  if (!deletePage(root, slug)) fail(`Missing page ${slug}`)
  return finish(root, `Removed page ${slug}.`)
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
  if (normalized === 'styles.css' || normalized === 'shell.njk' || normalized === 'labels.yml' || normalized === 'nav.yml') {
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

export function contentTools(root: string): ToolSet {
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
        'Write a page. Send slug, layout, title, and slots. title is an object keyed by language id, such as {"de":"TRAP","en":"TRAP"}. slots hold the values the layout declares: read_layout names them and their types. Translated text is an object keyed by language id; pictures, links and dates are stored once. Example: {"slug":"trap","layout":"article","title":{"de":"TRAP","en":"TRAP"},"slots":{"body":{"de":"Die Halle ist offen.","en":"The hall is open."}}}. Send every language that is not optional. Slots you send replace those slots; slots you leave out stay; send null to remove one. To change a page that exists, read_page first and send only what changes. Layout must already exist. If you change the layout of a page, send slots that fit the new layout and null for the ones it does not have. date marks a news item: omit it to keep the current date, send "" to remove it. A picture in markdown is ![caption](/media/name.jpg). Nothing is written when anything is wrong.',
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
        'Download one picture the person named from a public website and store the original. Do not download every image on a page. Omit name, description, and tags to have the tool look at the picture and fill a short name, a German description, and tags. An existing file with the same name is kept unless replace is true; set replace only when the person asked to replace that picture. Call fit_picture before you put it on a page.',
      input: z.object({
        url: z.string().describe('Required. Address of the picture.'),
        name: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        replace: z.boolean().optional(),
      }),
      execute: async ({ url, name, description, tags, replace }) => {
        const fetched = await fetchPublicBytes(url)
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

export function designTools(root: string): ToolSet {
  return {
    list_design: defineTool('list_design', {
      description: 'List the design files. Layouts are listed by list_layouts.',
      input: z.object({}),
      execute: () => ({
        files: ['brief.md', 'styles.css', 'shell.njk', 'nav.yml', 'labels.yml', 'categories.yml', 'fields.yml', 'site.yml'],
        layouts: listLayoutNames(path.join(root, 'design')).map((name) => layoutLabel(root, name)),
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
        'Write a layout, all of it at once: name, purpose, slots, template, and style. A layout may be for one page. Use list_layouts first. A layout is a page shape, so it never holds one page’s words: text comes from slots, and short interface text from labels in design/labels.yml. slots is an object of slot names to a type: text, markdown, image, link, date, list, or group. Text and markdown hold one entry per language; the others are stored once. Write a slot as "text", or as {"type":"text","required":true,"translate":false}. A list has "of", the type of one item, and a group has "fields". Example slots: {"lede":"text","body":{"type":"markdown","required":true},"photo":"image","facts":{"type":"list","of":{"label":"text","value":{"type":"text","translate":false}}}}. title, date and layout are page fields, not slots. The template extends shell.njk and shows slots with {{ slots.name }} (markdown is already HTML); title, date, labels, news, upcoming, and lang are also available. style is CSS for this layout only and may use Tailwind classes: it applies to pages with this layout and nothing else. Every slot must be shown in the template, and the template may only read declared slots. Nothing is written when anything is wrong.',
      input: z.object({
        name: z.string().describe('Required. Lowercase words with dashes, such as room-wide.'),
        purpose: z.string().describe('Required. One line: what pages this layout is for.'),
        slots: z.record(z.string(), z.any()).describe('Required. Slot names to types. {} for a layout with no slots.'),
        template: z.string().describe('Required. The full template.njk.'),
        style: z.string().optional().describe('Optional. The full style.css for this layout. Omit to keep the current one.'),
      }),
      execute: ({ name, purpose, slots, template, style }) => {
        const designDir = path.join(root, 'design')
        for (const [rel, content] of [
          [`layouts/${name}/template.njk`, template],
          ...(style === undefined ? [] : [[`layouts/${name}/style.css`, style]]),
        ] as [string, string][]) {
          const refused = guardDesignWrite(root, rel, content)
          if (refused) fail(refused)
          if (rel.endsWith('.css')) {
            const blank = documentOpacityRefusal(content)
            if (blank) fail(blank)
          }
        }
        const before = layoutExists(designDir, name) ? readLayoutFiles(designDir, name) : null
        const { warnings } = writeLayout(designDir, { name, purpose, slots, template, style })
        try {
          const notes = layoutReport(root, name, warnings)
          const summary = `${before ? 'Updated' : 'Wrote'} layout ${name}.${notes.length > 0 ? `\n${notes.join('\n')}` : ''}`
          return finish(root, `${summary}\n${briefLine('styles.css')}`.trimEnd(), { design: true })
        } catch (error) {
          restoreLayout(designDir, name, before)
          throw error
        }
      },
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
    replace_layout: defineTool('replace_layout', {
      description:
        'Remove a layout and point every page that used it at another layout. The pages keep their slot values, so the other layout has to take the same slots; write_page fixes any that do not fit.',
      input: z.object({
        from: z.string().describe('Required. Layout to remove.'),
        to: z.string().describe('Required. Layout that stays.'),
      }),
      execute: ({ from, to }) => {
        const updated = replaceLayout(root, from, to)
        const problems = updated.flatMap((slug) => {
          const page = readPage(root, slug)
          const found = page ? checkPage(root, page) : []
          return found.length > 0 ? [`${slug}: ${found.join('; ')}`] : []
        })
        const note = problems.length > 0 ? `\nThese pages do not fit ${to} yet: ${problems.join(' | ')}. Fix them with write_page.` : ''
        return finish(root, `Moved ${updated.join(', ') || 'no pages'} from ${from} to ${to}.${note}`, { design: true })
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
        'Overwrite a design file with the full new content: brief.md, styles.css, shell.njk, nav.yml, labels.yml, categories.yml, fields.yml, or site.yml. Write a layout with write_layout. This restyles every page. The shell and styles must not name one page, hold a picture address, or hold words: interface text goes in labels.yml. A stylesheet that sets opacity 0 on html or body is refused.',
      input: z.object({
        path: z.string().describe('Required. Path relative to design/, such as styles.css.'),
        content: z.string().min(1).describe('Required. The full new content of the file.'),
      }),
      execute: ({ path: rel, content }) => {
        const target = rel.trim().replaceAll('\\', '/')
        if (!target) fail('write_design: path is required, such as styles.css. Nothing was written.')
        const layoutFile = /^layouts\/([a-z0-9-]+)\/(layout\.yml|template\.njk|style\.css)$/.exec(target)
        if (layoutFile?.[2] === 'layout.yml') fail('Write a layout’s slots and purpose with write_layout. Nothing was written.')
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
        const file = designFilePath(root, target)
        const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
        fs.writeFileSync(file, content)
        try {
          return finish(root, `Updated design/${target}. Every page was regenerated. ${briefLine(target)}`.trim(), { design: true })
        } catch (error) {
          if (original) fs.writeFileSync(file, original)
          else fs.rmSync(file, { force: true })
          throw error
        }
      },
    }),
    read_website: defineTool('read_website', {
      description:
        'Read one public page. Returns its HTML with scripts and style blocks removed, absolute addresses, one address per picture, mailto links for protected addresses, and a short colors-and-fonts note. A long page is cut and says so. Call it again for each further page.',
      input: z.object({ url: z.string().describe('Required. Address of the page.') }),
      execute: ({ url }) => readWebsite(url),
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
      description: 'Record a setup proposal without writing it onto the site. The person accepts it before it is applied.',
      input: z.object({ proposal: z.record(z.string(), z.unknown()).describe('Required. The proposal.') }),
      execute: ({ proposal }) => {
        recordProposal(root, proposal as SetupProposal)
        return 'Recorded the proposal. It is not on the site until it is accepted.'
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

export function toolsFor(mode: EditorMode, root: string): ToolSet {
  const edit = { ...contentTools(root), ...designTools(root) }
  return mode === 'setup' ? { ...edit, ...setupTools(root) } : edit
}
