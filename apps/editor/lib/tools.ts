import fs from 'node:fs'
import path from 'node:path'
import { tool, type ToolSet } from 'ai'
import { searchContent } from './content-search'
import { guardDesignWrite } from './layout-guard'
import { unavailableToolMessage, type EditorMode } from './mode'
import { suggestPicture } from './picture-vision'
import { detectPicture, discardPicture, fitPicture, readPicture, searchPictures, stemFromFilename, storePicture } from './pictures'
import { fetchPublicBytes, readWebsite } from './read-website'
import { readSite } from './read-site'
import { z } from 'zod'
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

const lang = z.string()

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
  if (slug === 'home') return 'The home page cannot be removed.'
  assertSlug(slug)
  const files = readSiteConfig(root).languages
    .map((language) => contentPagePath(root, slug, language.id))
    .filter((file) => fs.existsSync(file))
  if (files.length === 0) return `Missing page ${slug}`
  for (const file of files) fs.rmSync(file)
  const dir = path.dirname(files[0])
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  return finish(root, `Removed page ${slug}.`)
}

function readContentYaml(root: string, folder: 'events' | 'places', slug: string, label: string): string {
  assertSlug(slug)
  const file = path.join(root, 'content', folder, `${slug}.yml`)
  if (!fs.existsSync(file)) return `Missing ${label} ${slug}`
  return fs.readFileSync(file, 'utf8')
}

function removeYaml(root: string, folder: 'events' | 'places', slug: string, label: string): string {
  assertSlug(slug)
  const file = path.join(root, 'content', folder, `${slug}.yml`)
  if (!fs.existsSync(file)) return `Missing ${label} ${slug}`
  fs.rmSync(file)
  return finish(root, `Removed ${label} ${slug}.`)
}

function defaultLanguage(root: string): string {
  return readSiteConfig(root).languages[0]?.id ?? 'de'
}

function knownLanguage(root: string, language: string): string | null {
  return readSiteConfig(root).languages.some((item) => item.id === language) ? null : `Unknown language ${language}`
}

function textMap(
  root: string,
  provided: Record<string, string> | undefined,
  german: string | undefined,
  english: string | undefined,
): { value: Record<string, string> } | { error: string } {
  const value = { ...(provided ?? {}) }
  if (german) value.de = german
  if (english) value.en = english
  for (const language of readSiteConfig(root).languages) {
    if (!language.optional && !value[language.id]?.trim()) return { error: `Missing ${language.label} text` }
  }
  return { value }
}

export function contentTools(root: string): ToolSet {
  return {
    search_content: tool({
      description:
        'Search pages, events, and places for a literal phrase. Returns matching lines and file paths. Use this to find one file before reading it. Do not pass a pattern.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => searchContent(root, query),
    }),
    list_pages: tool({
      description: 'List pages. Each line is the slug, the title in the default language, and the date when the page is a news item.',
      inputSchema: z.object({}),
      execute: async () => pages(root),
    }),
    read_page: tool({
      description:
        'Read one language of a page, including its front matter and markdown body. Before write_page, copy slug, lang, title, layout, and the full body from this file.',
      inputSchema: z.object({ slug: z.string(), lang }),
      execute: async ({ slug, lang: language }) => {
        const file = contentPagePath(root, slug, language)
        if (!fs.existsSync(file)) return `Missing page ${slug} ${language}`
        return fs.readFileSync(file, 'utf8')
      },
    }),
    write_page: tool({
      description:
        'Write one language of one page. Always send slug, lang, title, layout, and body together. Never send only body. When the page exists, call read_page first and copy those values, then change only what was asked. Example: {"slug":"trap","lang":"en","title":"TRAP","layout":"article","body":"![Hall](/media/trap-halle-neu.jpg)\\n\\nThe hall is open."}. Layout must already exist. date marks a news item. fields you pass replace those keys, and other stored fields stay. A private layout reads fields as slots, such as badge. On a layout or look request, keep the sentences, slots, title, pictures, email, groups, and date, and you may move them. You may fix grammar, tighten a label, take a card title from the first words of a sentence, or add a short label that adds no claim. Ask before you replace a sentence. Words the person asked to change may be rewritten.',
      inputSchema: z.object({
        slug: z.string().describe('Required. Page slug, such as trap.'),
        lang: z.string().describe('Required. Language id, such as de or en. One language per call.'),
        title: z.string().describe('Required. Title in that language. Keep the existing title unless asked to change it.'),
        layout: z.string().describe('Required. Name of a layout that already exists, such as article.'),
        date: z.string().optional().describe('Optional YYYY-MM-DD. Only for a news item. Omit to leave the page undated.'),
        body: z.string().describe('Required. Full markdown for this language. A picture is ![caption](/media/name.jpg).'),
        fields: z.record(z.string(), z.any()).optional().describe('Optional object. Keys you pass replace those keys. Omit to keep stored fields.'),
      }),
      execute: async ({ slug, lang: language, title, layout, date, body, fields }) => {
        const unknown = knownLanguage(root, language)
        if (unknown) return unknown
        pageLayoutsOrThrow(root, layout)
        const file = contentPagePath(root, slug, language)
        const existing = fs.existsSync(file) ? readPageFile(file, slug, language).data : {}
        const kept = { ...existing }
        delete kept.layout
        delete kept.title
        delete kept.date
        writePageFile(file, { layout, title, date, body, data: { ...kept, ...(fields ?? {}) } })
        return finish(root, `Wrote page ${slug} (${language}) with layout ${layout}.`)
      },
    }),
    delete_page: tool({
      description:
        'Remove a page from the draft, including every language file. The home page cannot be removed. Navigation links and pictures stay. The public site keeps the page until publish.',
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => removePage(root, slug),
    }),
    list_events: tool({
      description: 'List events. Each line is the slug, the title, and each date as start or start–end. Use the slug with read_event before changing an event.',
      inputSchema: z.object({}),
      execute: async () => {
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
    read_event: tool({
      description:
        'Read one event, including its title, body, place, categories, fields, and dates. Call this before write_event when the event already exists, then write it back with the same slug.',
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => {
        assertSlug(slug)
        const file = path.join(root, 'content', 'events', `${slug}.yml`)
        if (!fs.existsSync(file)) return `Missing event ${slug}`
        return fs.readFileSync(file, 'utf8')
      },
    }),
    write_event: tool({
      description:
        'Write an event. Always send slug, place, categories, and dates together. title and body are objects keyed by language id, such as {"de":"Halle","en":"Hall"}, never a string. titleDe, titleEn, bodyDe, and bodyEn also fill those languages. dates is an array of {"start":"2026-05-01T18:00","end":"2026-05-01T21:00"}, never a string. categories is an array of existing option ids; pass [] when there are none. To change an event, call read_event and pass that same slug, keeping the title, body, place, categories, fields, and dates the person did not ask to change. On a layout or look request, keep the sentences and the title, and ask before you replace a sentence. Place must already exist.',
      inputSchema: z.object({
        slug: z.string().describe('Required. Event slug. Same slug as read_event when the event exists.'),
        title: z.record(z.string(), z.string()).optional().describe('Object of language id to text, such as {"de":"Halle","en":"Hall"}. Never a string.'),
        body: z.record(z.string(), z.string()).optional().describe('Object of language id to markdown. Never a string.'),
        titleDe: z.string().optional().describe('Optional German title. Sets title.de.'),
        titleEn: z.string().optional().describe('Optional English title. Sets title.en.'),
        bodyDe: z.string().optional().describe('Optional German markdown body. Sets body.de.'),
        bodyEn: z.string().optional().describe('Optional English markdown body. Sets body.en.'),
        place: z.string().describe('Required. Slug of a place that already exists.'),
        categories: z.array(z.string()).describe('Required. Existing category option ids. Pass [] when there are none.'),
        fields: z.record(z.string(), z.string()).optional().describe('Optional object of field id to an existing option id.'),
        dates: z.array(z.object({
          start: z.string().describe('Required ISO date or datetime, such as 2026-05-01T18:00.'),
          end: z.string().optional().describe('Optional ISO end. Omit for a single moment.'),
        })).describe('Required array of {start, end?}. Never a string.'),
      }),
      execute: async (input) => {
        assertSlug(input.slug)
        assertSlug(input.place)
        const placeFile = path.join(root, 'content', 'places', `${input.place}.yml`)
        if (!fs.existsSync(placeFile)) return `Unknown place ${input.place}`
        const title = textMap(root, input.title, input.titleDe, input.titleEn)
        if ('error' in title) return title.error
        const body = textMap(root, input.body, input.bodyDe, input.bodyEn)
        if ('error' in body) return body.error
        const known = readEventFields(root)
        const categories = known.find((field) => field.id === 'categories')
        for (const category of input.categories) {
          if (categories && !categories.options.some((option) => option.id === category)) return `Unknown category ${category}`
        }
        for (const [id, optionId] of Object.entries(input.fields ?? {})) {
          const field = known.find((item) => item.id === id)
          if (!field) return `Unknown field ${id}`
          if (optionId && !field.options.some((option) => option.id === optionId)) return `Unknown option ${optionId}`
        }
        const event: EventDoc = {
          slug: input.slug,
          title: title.value,
          body: body.value,
          place: input.place,
          categories: input.categories,
          fields: input.fields,
          dates: input.dates,
        }
        writeYaml(path.join(root, 'content', 'events', `${input.slug}.yml`), event)
        return finish(root, `Wrote event ${input.slug} with ${input.dates.length} dates.`)
      },
    }),
    delete_event: tool({
      description: 'Remove one event from the draft. The place it names stays. The public site keeps the event until publish.',
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => removeYaml(root, 'events', slug, 'event'),
    }),
    write_place: tool({
      description:
        'Write a place. Always send slug and onPremises. name is an object keyed by language id, such as {"de":"Halle","en":"Hall"}, never a string. nameDe and nameEn also fill those languages. address is optional. On a layout or look request, keep the name and address unless the person asked to change them.',
      inputSchema: z.object({
        slug: z.string().describe('Required. Place slug.'),
        name: z.record(z.string(), z.string()).optional().describe('Object of language id to name. Never a string.'),
        nameDe: z.string().optional().describe('Optional German name. Sets name.de.'),
        nameEn: z.string().optional().describe('Optional English name. Sets name.en.'),
        address: z.string().optional().describe('Optional postal address.'),
        onPremises: z.boolean().describe('Required boolean. True when the place is on the premises.'),
      }),
      execute: async (input) => {
        assertSlug(input.slug)
        const name = textMap(root, input.name, input.nameDe, input.nameEn)
        if ('error' in name) return name.error
        const place: PlaceDoc = {
          slug: input.slug,
          name: name.value,
          address: input.address,
          onPremises: input.onPremises,
        }
        writeYaml(path.join(root, 'content', 'places', `${input.slug}.yml`), place)
        return finish(root, `Wrote place ${input.slug}.`)
      },
    }),
    list_places: tool({
      description: 'List places. Each line is the slug and the name.',
      inputSchema: z.object({}),
      execute: async () => {
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
    read_place: tool({
      description: 'Read one place, including its name, address, and whether it is on the premises.',
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => readContentYaml(root, 'places', slug, 'place'),
    }),
    delete_place: tool({
      description: 'Remove one place from the draft. Events that name it keep that place slug. The public site keeps the place until publish.',
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => removeYaml(root, 'places', slug, 'place'),
    }),
    list_pictures: tool({
      description: 'Search pictures already stored, by name, German description, or tag. Pass a query. Returns addresses such as /media/hof.webp.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
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
    save_picture: tool({
      description:
        'Download one picture the person named from a public website and store the original. Do not download every image on a page. Call fit_picture when you put it on a page. The tool looks at the picture and fills a short name, a German description, and tags when you omit them. Set replace only when the person asked to replace that picture. Do not put the picture on a page unless they asked which page. An existing file with the same name is kept unless replace is true.',
      inputSchema: z.object({
        url: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        replace: z.boolean().optional(),
      }),
      execute: async ({ url, name, description, tags, replace }) => {
        try {
          const fetched = await fetchPublicBytes(url)
          const kind = detectPicture(fetched.body)
          if (!kind) return `Could not save ${url}: that file is not a JPEG, PNG, WebP, GIF, or SVG.`
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
        } catch (error) {
          return error instanceof Error ? error.message : 'Could not save that picture.'
        }
      },
    }),
    fit_picture: tool({
      description:
        'Make a WebP copy of a stored picture for the width a page gives it. Always send file and width. width is the CSS pixel width of that place, not the file width. The copy is twice that wide and keeps the proportions. A picture that is already smaller is left unchanged. A GIF or an SVG is left unchanged. An existing copy of that original at that width is reused. Use the returned address on the page. Example: {"file":"/media/hof.jpg","width":480}.',
      inputSchema: z.object({
        file: z.string().describe('Required. Stored picture address, such as /media/hof.jpg.'),
        width: z.number().int().positive().max(4096).describe('Required. The width that place gives the picture, in CSS pixels.'),
      }),
      execute: async ({ file, width }) => {
        try {
          const fitted = await fitPicture(root, file, width)
          if (fitted.wrote) generate(root)
          return fitted.message
        } catch (error) {
          return error instanceof Error ? error.message : 'Could not fit that picture.'
        }
      },
    }),
    read_picture: tool({
      description: 'Read one picture by its address or file name: the address, description, tags, and how often content uses it.',
      inputSchema: z.object({ file: z.string() }),
      execute: async ({ file }) => {
        try {
          const picture = readPicture(root, file)
          const tags = picture.tags.join(', ') || 'no tags'
          const times = picture.usages === 1 ? 'time' : 'times'
          return `${picture.address} — ${picture.description || 'no description'} — ${tags} — used ${picture.usages} ${times}`
        } catch (error) {
          return error instanceof Error ? error.message : 'Unknown picture.'
        }
      },
    }),
    discard_picture: tool({
      description:
        'Discard one picture you name, by its address or file name. The file leaves the draft even when a page still uses it. Pages keep the address. This is the same discard as the media manager.',
      inputSchema: z.object({ file: z.string() }),
      execute: async ({ file }) => {
        try {
          const picture = readPicture(root, file)
          discardPicture(root, picture.file)
          return finish(root, `Discarded ${picture.address}.`)
        } catch (error) {
          return error instanceof Error ? error.message : 'Unknown picture.'
        }
      },
    }),
    set_homepage_news: tool({
      description: 'Choose which news items appear on the homepage, in order.',
      inputSchema: z.object({ slugs: z.array(z.string()) }),
      execute: async ({ slugs }) => {
        const language = defaultLanguage(root)
        for (const slug of slugs) {
          const file = contentPagePath(root, slug, language)
          if (!fs.existsSync(file)) return `Unknown page ${slug}`
          const page = readPageFile(file, slug, language)
          if (!page.date) return `${slug} is not a news item`
        }
        writeYaml(path.join(root, 'content', 'home.yml'), { news: slugs })
        return finish(root, `Homepage news is now ${slugs.join(', ') || 'the latest items'}.`)
      },
    }),
  }
}

export function designTools(root: string): ToolSet {
  return {
    list_design: tool({
      description: 'List design files and page layouts.',
      inputSchema: z.object({}),
      execute: async () => {
        const layouts = fs.readdirSync(path.join(root, 'design', 'layouts'))
        return { files: ['brief.md', 'styles.css', 'shell.njk', 'nav.yml', 'categories.yml', 'fields.yml', 'site.yml'], layouts }
      },
    }),
    read_design: tool({
      description: 'Read a design file. Path is relative to design/, for example layouts/article.njk.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path: rel }) => fs.readFileSync(designFilePath(root, rel), 'utf8'),
    }),
    write_design: tool({
      description: 'Overwrite a design file. This restyles every page that uses it. A layout or the shell must not name one page, and a layout must not hold page text or a picture address. On a layout or look request, you may change structure. Keep every page’s sentences. Change a shell or navigation sentence only when the person asked to change those words or that part. Do not use this to delete a layout.',
      inputSchema: z.object({ path: z.string(), content: z.string().min(1) }),
      execute: async ({ path: rel, content }) => {
        const refused = guardDesignWrite(root, rel, content)
        if (refused) return refused
        const file = designFilePath(root, rel)
        const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
        fs.writeFileSync(file, content)
        try {
          return finish(root, `Updated design/${rel}. Every page was regenerated.`)
        } catch (error) {
          if (original) fs.writeFileSync(file, original)
          else fs.rmSync(file, { force: true })
          throw error
        }
      },
    }),
    read_website: tool({
      description: 'Read one public page. Returns its HTML with scripts and style blocks removed, absolute addresses, one address per picture, mailto links for protected addresses, and a short colors-and-fonts note.',
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }) => {
        try {
          return await readWebsite(url)
        } catch (error) {
          return error instanceof Error ? error.message : 'Could not read that page.'
        }
      },
    }),
    replace_layout: tool({
      description: 'Remove a page layout and move every page that used it onto another layout that still exists.',
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      execute: async ({ from, to }) => {
        const updated = replaceLayout(root, from, to)
        return finish(root, `Moved ${updated.join(', ') || 'no pages'} from ${from} to ${to}.`)
      },
    }),
  }
}

export function setupTools(root: string): ToolSet {
  return {
    read_site: tool({
      description: 'Read one public page, the same way as read_website. Call it again for each further page you need, including a post or a gallery. This is not a full archive import.',
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }) => {
        try {
          return await readSite(url)
        } catch (error) {
          return error instanceof Error ? error.message : 'Could not read that website.'
        }
      },
    }),
    propose_setup: tool({
      description: 'Record a setup proposal without writing it onto the site. The person accepts it before it is applied.',
      inputSchema: z.object({ proposal: z.record(z.string(), z.unknown()) }),
      execute: async ({ proposal }) => {
        recordProposal(root, proposal as SetupProposal)
        return 'Recorded the proposal. It is not on the site until it is accepted.'
      },
    }),
    accept_setup: tool({
      description: 'Write an accepted setup decision onto the site. Pass the decision in proposal. Set useRecorded when the person accepts the recorded proposal. Set finish when setup is done. A directive that already names a decision is acceptance for that decision: pass it and leave finish false.',
      inputSchema: z.object({
        proposal: z.record(z.string(), z.unknown()).optional(),
        useRecorded: z.boolean().optional(),
        finish: z.boolean().optional(),
      }),
      execute: async ({ proposal, useRecorded, finish: done }) => {
        const recorded = useRecorded ? readProposal(root) : {}
        const notes = applyProposal(root, { ...recorded, ...(proposal ?? {}) } as SetupProposal, done === true)
        return finish(root, `Accepted ${notes}.`)
      },
    }),
  }
}

function rejectTool(): ToolSet {
  return {
    reject_tool: tool({
      description: 'Do not call this. The editor uses it when a tool from the other mode was requested.',
      inputSchema: z.object({ message: z.string() }),
      execute: async ({ message }) => message,
    }),
  }
}

export function toolsFor(mode: EditorMode, root: string): ToolSet {
  if (mode === 'setup') return { ...contentTools(root), ...designTools(root), ...setupTools(root), ...rejectTool() }
  return { ...contentTools(root), ...designTools(root), ...rejectTool() }
}

export function repairUnavailableTool(mode: EditorMode) {
  return async ({
    toolCall,
    error,
  }: {
    toolCall: { type: 'tool-call'; toolCallId: string; toolName: string; input: string; providerExecuted?: boolean }
    error: unknown
  }) => {
    if (!error || typeof error !== 'object' || (error as { name?: string }).name !== 'AI_NoSuchToolError') return null
    const toolName = (error as { toolName?: string }).toolName ?? toolCall.toolName
    return {
      ...toolCall,
      toolName: 'reject_tool',
      input: JSON.stringify({ message: unavailableToolMessage(mode, toolName) }),
    }
  }
}

export function systemPrompt(mode: EditorMode, root: string): string {
  const brief = fs.readFileSync(path.join(root, 'design', 'brief.md'), 'utf8')
  const layouts = [...new Set(
    fs.readdirSync(path.join(root, 'design', 'layouts')).flatMap((name) => {
      const match = /^(.+)\.(?:njk|yml)$/.exec(name)
      return match?.[1] ? [match[1]] : []
    }),
  )]
  const site = readSiteConfig(root)
  const languages = site.languages.map((language) => `${language.id}${language.optional ? ' (optional)' : ''}`).join(', ')
  const shared = `Design brief:\n${brief}\n\nLayouts: ${layouts.join(', ')}.\n\nLanguages, first is the default: ${languages}. Timezone: ${site.timezone}.`
  if (mode === 'setup') {
    return `${shared}\n\nYou are in setup. You may use the content tools, the design tools, read_site, propose_setup, and accept_setup. read_site reads one public page and returns its HTML, with scripts and style blocks removed, absolute addresses, one address per picture, mailto links for protected addresses, and a short colors-and-fonts note. Call read_site again for each further page you need, including a post or a gallery. It does not import a full archive. From a URL, propose languages, which layouts to keep or add, the sections on each layout, event fields, the look, and a first pass of content. Record that with propose_setup and wait. A directive that already names a decision is acceptance for that decision: call accept_setup with that part and leave finish false. Call accept_setup with useRecorded and finish when the person accepts the whole proposal. When you put a picture on a page, call fit_picture with its stored address and the width that place gives it, in CSS pixels, then use the address it returns. A GIF or an SVG stays as stored. A layout is an ordered list of sections. Shapes are title, prose, hero, cards, band, pictures, email, picture-groups, link-groups, news, and upcoming. Do not invent a shape. Event, place, calendar, and archive stay. The first language has no URL prefix. A language marked optional does not block publish.`
  }
  return `${shared}\n\nYou edit the site in one mode. You may change pages, events, places, pictures, and the design in the same reply. Do not call read_site, propose_setup, or accept_setup. read_website reads one public page and returns its HTML, with scripts and style blocks removed, absolute addresses, one address per picture, mailto links for protected addresses, and a short colors-and-fonts note. When the person names a website, call read_website for that page, and call it again for each further page you need, instead of saying you cannot open a URL. A layout is structure and look. It must not hold one page's sentences, a picture address, or a rule that names that page by title, slug, or path. The shell and navigation may keep text that every page shows. They must not name one page. write_design refuses a layout or shell that breaks this. When it refuses, give each named page its own layout, write that page's words, point the page at the new layout, remove the page-specific rules, and write the design file again. Other pages stay on the shared layout. Use a kit layout, an ordered list of sections, when a shape can hold the content. Shapes are title, prose, hero, cards, band, pictures, email, picture-groups, link-groups, news, and upcoming. Do not invent a shape. A private Nunjucks layout is only for a look no shape can hold. It reads {{ slots.name }}. Write those values with write_page fields. Do not put the words in the template. When the person asks for a layout or a look, you may change the structure. Keep each page's sentences and slot values. You may fix grammar, tighten a label, or take a card title from the first words of a sentence. A new phrase may be a short label in the layout or on the page, and it adds no claim. Leave the title in each language unless they asked to change it. Events and places follow the same rule, including their titles. Keep the same pictures, email, groups, and dates, and you may move them. Hold every language to that standard. Words they explicitly ask to change may be rewritten. If the request does not say whether they mean the look or the words, you may change the structure and keep the sentences, and you ask before you replace a sentence. Change a shell or navigation sentence only when they asked to change those words or that part of the shell. When you change a shared layout, every page on it keeps its sentences the same way. A change to a shared layout restyles every page that uses it. To drop a page layout, call replace_layout so those pages move together. The event, calendar, and archive layouts stay; overwrite them instead of removing them. Removing a field does not rewrite existing events. save_picture downloads one picture the person named from a public website. It stores a JPEG, PNG, WebP, GIF, or SVG with the site's other pictures and returns an address such as /media/hof.webp. Do not save every image on a page. When you put a picture on a page, call fit_picture with its stored address and the width that place gives it, in CSS pixels, then use the address it returns. Do this for a picture already on a page you are writing. A GIF or an SVG stays as stored. Do not fit pictures on pages you are not writing. Do not put a picture on a page unless the person says which page. Search with list_pictures before downloading a picture that may already be stored. discard_picture removes one picture you name, even when a page still uses it. Pages keep the address. To find a page, event, or place, call search_content with a short phrase, then read that one file. List pages or events when you need every date, such as removing old news and events. Do not read every file. delete_page removes every language of that slug. The home page cannot be removed. delete_event and delete_place remove that one file. A deleted place stays named on its events. A navigation link stays. To change an event, call read_event, then write_event with that same slug. Keep the title, body, place, categories, fields, and dates the person did not ask to change. Do not invent a new slug for an event that already exists. Event files live under content/events and are not design files. Write every language that is not optional. Pick a layout that already exists. write_page requires slug, lang, title, layout, and body together. Never send only the body. write_event requires slug, place, categories, and dates. Its title and body are objects keyed by language id, not strings. write_place requires slug and onPremises. Its name is an object keyed by language id, not a string. Fill the sections that layout declares by moving the existing sentences into them. Event field option ids must already exist. When asked to remove content older than a period, use today in the site timezone. A news item is old when its date is before that cutoff. An event is old when the later of its start and end, across every date, is before that cutoff. Skip pages with no date, events with no dates, places, and pictures unless the person names them. Skip the home page. Delete each match and say what you removed. You may call set_homepage_news in the same reply to drop a deleted news slug. Finish by saying what changed. If you saved nothing, say that nothing was saved.`
}
