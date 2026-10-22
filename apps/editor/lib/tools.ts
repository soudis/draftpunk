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
import { sectionListNote, unusedFieldNote } from './section-fields'
import { defineTool, fail } from './tool-kit'
import {
  assertSlug,
  applyProposal,
  contentPagePath,
  designFilePath,
  generate,
  listPageSlugs,
  pageLayoutsOrThrow,
  readEventFields,
  readPageFile,
  readProposal,
  readYaml,
  readSiteConfig,
  recordProposal,
  replaceLayout,
  writePageFile,
  writeYaml,
  type EventDoc,
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
    const file = contentPagePath(root, slug, language)
    if (!fs.existsSync(file)) return slug
    const page = readPageFile(file, slug, language)
    return page.date ? `${slug} — ${page.title} — ${page.date}` : `${slug} — ${page.title}`
  })
}

function finish(root: string, summary: string): string {
  generate(root)
  return summary
}

function removePage(root: string, slug: string): string {
  if (slug === 'home') fail('The home page cannot be removed.')
  assertSlug(slug)
  const files = readSiteConfig(root).languages
    .map((language) => contentPagePath(root, slug, language.id))
    .filter((file) => fs.existsSync(file))
  if (files.length === 0) fail(`Missing page ${slug}`)
  for (const file of files) fs.rmSync(file)
  const dir = path.dirname(files[0])
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
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

function wrotePage(
  root: string,
  slug: string,
  written: string[],
  layout: string,
  fields: Record<string, unknown> | undefined,
): string {
  const parts = [`Wrote page ${slug} (${written.join(', ')}) with layout ${layout}.`]
  const unused = fields ? layoutFieldNote(root, layout, fields) : ''
  if (unused) parts.push(unused)
  const others = readSiteConfig(root).languages
    .filter((item) => !written.includes(item.id))
    .map((item) => {
      const file = contentPagePath(root, slug, item.id)
      if (!fs.existsSync(file)) return item.optional ? '' : `${item.id} is missing.`
      const page = readPageFile(file, slug, item.id)
      return page.layout === layout ? '' : `${item.id} still uses layout ${page.layout}.`
    })
    .filter(Boolean)
  if (others.length > 0) parts.push(others.join(' '))
  return parts.join(' ')
}

function layoutFieldNote(root: string, layout: string, fields: Record<string, unknown>): string {
  if (fs.existsSync(path.join(root, 'design', 'layouts', `${layout}.njk`))) return ''
  const shapes = layoutShapes(root, layout)
  if (!shapes) return ''
  return unusedFieldNote(shapes, fields)
}

function layoutShapes(root: string, name: string): string[] | null {
  const file = path.join(root, 'design', 'layouts', `${name}.yml`)
  if (!fs.existsSync(file)) return null
  const raw = readYaml<{ sections?: { shape?: string }[] }>(file, {})
  return (raw.sections ?? []).map((section) => String(section.shape ?? ''))
}

function layoutLabel(name: string): string {
  if (name.endsWith('.yml')) return `${name} — section list`
  if (name.endsWith('.njk')) return `${name} — private template`
  return name
}

function readDesignFile(root: string, rel: string): string {
  const normalized = rel.replaceAll('\\', '/')
  let file: string
  try {
    file = designFilePath(root, normalized)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read that design file.'
    if (message.startsWith('Design path is not allowed')) fail(`${message}. Kit shapes are not a file in the site.`)
    fail(message)
  }
  if (!fs.existsSync(file)) fail(missingDesign(root, normalized))
  const text = fs.readFileSync(file, 'utf8')
  const layout = /^layouts\/([a-z0-9-]+)\.yml$/u.exec(normalized)
  if (!layout) return text
  const shapes = layoutShapes(root, layout[1])
  if (!shapes) return text
  const template = path.join(root, 'design', 'layouts', `${layout[1]}.njk`)
  const templatePath = fs.existsSync(template) ? `layouts/${layout[1]}.njk` : null
  return `${text.trimEnd()}\n\n${sectionListNote(shapes, templatePath)}`
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

function missingDesign(root: string, rel: string): string {
  const match = /^layouts\/([a-z0-9-]+)\.(njk|yml)$/u.exec(rel)
  if (match) {
    const other = match[2] === 'njk' ? 'yml' : 'njk'
    const otherPath = `layouts/${match[1]}.${other}`
    if (fs.existsSync(path.join(root, 'design', otherPath))) return `Missing design/${rel}. ${otherPath} is the file.`
  }
  return `Missing design/${rel}.`
}

function briefLine(rel: string): string {
  const normalized = rel.replaceAll('\\', '/')
  if (normalized === 'styles.css' || normalized === 'shell.njk') {
    return 'Rewrite the shared look in design/brief.md and leave the layout lines.'
  }
  const layout = /^layouts\/([a-z0-9-]+)\.(?:njk|yml)$/u.exec(normalized)
  if (!layout) return ''
  return `Rewrite only the ${layout[1]} line in design/brief.md. Leave the shared look and the other layout lines. A layout used by one page does not replace the shared look.`
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
        'Read a page with its front matter and markdown body. Without lang it returns every language. Before write_page, copy what you do not change from this.',
      input: z.object({
        slug: z.string().describe('Required. Page slug.'),
        lang: z.string().optional().describe('Optional language id, such as de. Omit to read every language.'),
      }),
      execute: ({ slug, lang: language }) => {
        const ids = language ? [language] : readSiteConfig(root).languages.map((item) => item.id)
        const found = ids.flatMap((id) => {
          const file = contentPagePath(root, slug, id)
          return fs.existsSync(file) ? [{ id, text: fs.readFileSync(file, 'utf8') }] : []
        })
        if (found.length === 0) fail(`Missing page ${slug}${language ? ` ${language}` : ''}`)
        if (language) return found[0].text
        return found.map((item) => `=== ${item.id} ===\n${item.text}`).join('\n')
      },
    }),
    write_page: defineTool('write_page', {
      description:
        'Write a page in every language in one call. Send slug, layout, and languages. Example: {"slug":"trap","layout":"article","languages":{"de":{"title":"TRAP","body":"Die Halle ist offen."},"en":{"title":"TRAP","body":"The hall is open."}}}. Send every language that is not optional; if any is missing nothing is written. To change a page that exists, call read_page first and send the parts you do not change as they are. Layout must already exist. date marks a news item: omit it to keep the page’s current date, send "" to remove it. fields you send replace those keys in every language you write, and other stored fields stay. A private layout reads fields as slots. A picture in a body is ![caption](/media/name.jpg).',
      input: z.object({
        slug: z.string().describe('Required. Page slug, such as trap.'),
        layout: z.string().describe('Required. Name of a layout that already exists, such as article.'),
        languages: z
          .record(z.string(), z.object({ title: z.string().min(1), body: z.string() }))
          .describe('Required. Language id to {title, body}. The body is the full markdown for that language.'),
        date: z.string().optional().describe('Optional YYYY-MM-DD, only for a news item. Omit to keep the current date. "" removes it.'),
        fields: z.record(z.string(), z.any()).optional().describe('Optional object. Keys you send replace those keys. Omit to keep stored fields.'),
      }),
      execute: ({ slug, layout, languages, date, fields }) => {
        assertSlug(slug)
        pageLayoutsOrThrow(root, layout)
        const site = readSiteConfig(root)
        const ids = Object.keys(languages)
        const unknown = ids.filter((id) => !site.languages.some((item) => item.id === id))
        if (unknown.length > 0) fail(`Unknown language ${unknown.join(', ')}. Use ${languageChoice(root)}. Nothing was written.`)
        const missing = site.languages.filter((item) => !item.optional && !languages[item.id])
        if (missing.length > 0) {
          fail(`Missing ${missing.map((item) => `${item.label} (${item.id})`).join(', ')} in languages. Send every language that is not optional. Nothing was written.`)
        }
        const current = site.languages
          .map((item) => contentPagePath(root, slug, item.id))
          .filter((file) => fs.existsSync(file))
          .map((file) => readPageFile(file, slug, path.basename(file, '.md')))
        const keptDate = date === undefined ? current.find((page) => page.date)?.date : date || undefined
        for (const id of ids) {
          const file = contentPagePath(root, slug, id)
          const existing = fs.existsSync(file) ? readPageFile(file, slug, id).data : {}
          const kept = { ...existing }
          delete kept.layout
          delete kept.title
          delete kept.date
          writePageFile(file, {
            layout,
            title: languages[id].title,
            date: keptDate,
            body: languages[id].body,
            data: { ...kept, ...(fields ?? {}) },
          })
        }
        return finish(root, wrotePage(root, slug, ids, layout, fields))
      },
    }),
    delete_page: defineTool('delete_page', {
      description:
        'Remove a page from the draft, including every language file. The home page cannot be removed. Navigation links and pictures stay. The public site keeps the page until publish.',
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
        const language = defaultLanguage(root)
        for (const slug of slugs) {
          const file = contentPagePath(root, slug, language)
          if (!fs.existsSync(file)) fail(`Unknown page ${slug}`)
          const page = readPageFile(file, slug, language)
          if (!page.date) fail(`${slug} is not a news item`)
        }
        writeYaml(path.join(root, 'content', 'home.yml'), { news: slugs })
        return finish(root, `Homepage news is now ${slugs.join(', ') || 'the latest items'}.`)
      },
    }),
  }
}

export function designTools(root: string): ToolSet {
  return {
    list_design: defineTool('list_design', {
      description: 'List design files and page layouts. Each layout is a section list or a private template.',
      input: z.object({}),
      execute: () => {
        const layouts = fs.readdirSync(path.join(root, 'design', 'layouts')).sort().map(layoutLabel)
        return { files: ['brief.md', 'styles.css', 'shell.njk', 'nav.yml', 'categories.yml', 'fields.yml', 'site.yml'], layouts }
      },
    }),
    read_design: defineTool('read_design', {
      description:
        'Read a design file. Path is relative to design/, for example layouts/article.yml. A missing layout names the other extension when that file exists. A section list includes the field each section shows. A file longer than 24000 characters comes back in pieces; the reply names the offset to continue from.',
      input: z.object({
        path: z.string().describe('Required. Path relative to design/, such as styles.css.'),
        offset: z.number().int().min(0).optional().describe('Optional character offset to continue a long file.'),
      }),
      execute: ({ path: rel, offset }) => windowText(readDesignFile(root, rel), offset ?? 0),
    }),
    write_design: defineTool('write_design', {
      description:
        'Overwrite a design file with the full new content. This restyles every page that uses it. A layout or the shell must not name one page, and a layout must not hold page text or a picture address. Do not use this to delete a layout. A stylesheet that sets opacity 0 on html or body is refused.',
      input: z.object({
        path: z.string().describe('Required. Path relative to design/, such as styles.css or layouts/article.yml.'),
        content: z.string().min(1).describe('Required. The full new content of the file.'),
      }),
      execute: ({ path: rel, content }) => {
        const target = rel.trim()
        if (!target) fail('write_design: path is required, such as styles.css or layouts/article.yml. Nothing was written.')
        const refused = guardDesignWrite(root, target, content)
        if (refused) fail(refused)
        if (target.replaceAll('\\', '/') === 'styles.css') {
          const blank = documentOpacityRefusal(content)
          if (blank) fail(blank)
        }
        const file = designFilePath(root, target)
        const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
        fs.writeFileSync(file, content)
        try {
          return finish(root, `Updated design/${target}. Every page was regenerated. ${briefLine(target)}`.trim())
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
    replace_layout: defineTool('replace_layout', {
      description: 'Remove a page layout and move every page that used it onto another layout that still exists.',
      input: z.object({
        from: z.string().describe('Required. Layout to remove.'),
        to: z.string().describe('Required. Layout that stays.'),
      }),
      execute: ({ from, to }) => {
        const updated = replaceLayout(root, from, to)
        return finish(root, `Moved ${updated.join(', ') || 'no pages'} from ${from} to ${to}.`)
      },
    }),
  }
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
