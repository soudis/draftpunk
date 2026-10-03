import fs from 'node:fs'
import path from 'node:path'
import { contentPagePath, REQUIRED_LAYOUTS, writePageFile, writeYaml, type EventDoc, type PlaceDoc } from './content'
import { pageLayoutsOrThrow, replaceLayout } from './generate'
import {
  readEventFields,
  readSiteConfig,
  readYamlFile,
  SECTION_SHAPES,
  writeYamlFile,
  type SectionShape,
  type SiteLanguage,
} from './model'

export type SetupProposal = {
  site?: {
    name?: string
    id?: string
    timezone?: string
    languages?: { id: string; label?: string; optional?: boolean }[]
  }
  layouts?: { name: string; sections: { shape: string; heading?: Record<string, string> }[] }[]
  dropLayouts?: string[]
  fields?: unknown[]
  look?: { styles?: string; shell?: string; brief?: string }
  nav?: unknown
  pages?: {
    slug: string
    lang: string
    title: string
    layout: string
    body: string
    date?: string
    fields?: Record<string, unknown>
  }[]
  events?: EventDoc[]
  places?: PlaceDoc[]
}

export function recordProposal(root: string, proposal: SetupProposal): void {
  const current = readYamlFile<SetupProposal>(path.join(root, 'design', 'proposal.yml'), {})
  writeYamlFile(path.join(root, 'design', 'proposal.yml'), { ...current, ...proposal })
}

export function readProposal(root: string): SetupProposal {
  return readYamlFile<SetupProposal>(path.join(root, 'design', 'proposal.yml'), {})
}

export function applyProposal(root: string, proposal: SetupProposal, finish = false): string {
  if (proposal.site?.timezone?.trim()) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: proposal.site.timezone.trim() }).format(new Date())
    } catch {
      throw new Error(`Unknown timezone ${proposal.site.timezone}`)
    }
  }
  const notes: string[] = []
  if (proposal.site) {
    const current = readSiteConfig(root)
    const languages = proposal.site.languages?.map(normalizeLanguage).filter((lang): lang is SiteLanguage => Boolean(lang))
    writeYamlFile(path.join(root, 'design', 'site.yml'), {
      name: proposal.site.name?.trim() || current.name,
      id: proposal.site.id?.trim() || current.id,
      timezone: proposal.site.timezone?.trim() || current.timezone,
      languages: languages && languages.length > 0 ? languages : current.languages,
    })
    notes.push('site')
  }
  if (proposal.fields) {
    writeYamlFile(path.join(root, 'design', 'fields.yml'), proposal.fields)
    const categories = (Array.isArray(proposal.fields) ? proposal.fields : []).find(
      (field) => field && typeof field === 'object' && (field as { id?: string }).id === 'categories',
    ) as { options?: { id?: string; label?: Record<string, string>; de?: string; en?: string }[] } | undefined
    if (categories?.options) {
      writeYaml(
        path.join(root, 'design', 'categories.yml'),
        categories.options.map((option) => ({
          id: option.id,
          de: option.label?.de ?? option.de ?? option.id,
          en: option.label?.en ?? option.en ?? option.label?.de ?? option.id,
        })),
      )
    }
    notes.push('fields')
  }
  for (const layout of proposal.layouts ?? []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(layout.name)) throw new Error(`Layout name must be lowercase words: ${layout.name}`)
    if ((REQUIRED_LAYOUTS as readonly string[]).includes(layout.name)) {
      throw new Error(`Layout ${layout.name} is part of the calendar and archive.`)
    }
    const sections = layout.sections.map((section) => {
      if (!SECTION_SHAPES.includes(section.shape as SectionShape)) {
        throw new Error(`Unknown section shape: ${section.shape}`)
      }
      return section.heading ? { shape: section.shape, heading: section.heading } : { shape: section.shape }
    })
    writeYamlFile(path.join(root, 'design', 'layouts', `${layout.name}.yml`), { sections })
    notes.push(`layout ${layout.name}`)
  }
  for (const name of proposal.dropLayouts ?? []) {
    if ((REQUIRED_LAYOUTS as readonly string[]).includes(name)) {
      throw new Error(`Layout ${name} is part of the calendar and archive.`)
    }
    const used = pagesUsing(root, name)
    if (used.length > 0) replaceLayout(root, name, 'article')
    else {
      for (const ext of ['.njk', '.yml']) {
        const file = path.join(root, 'design', 'layouts', `${name}${ext}`)
        if (fs.existsSync(file)) fs.rmSync(file)
      }
    }
    notes.push(`dropped ${name}`)
  }
  if (proposal.look?.styles) {
    fs.writeFileSync(path.join(root, 'design', 'styles.css'), proposal.look.styles)
    notes.push('stylesheet')
  }
  if (proposal.look?.shell) {
    fs.writeFileSync(path.join(root, 'design', 'shell.njk'), proposal.look.shell)
    notes.push('shell')
  }
  if (proposal.look?.brief) {
    fs.writeFileSync(path.join(root, 'design', 'brief.md'), proposal.look.brief)
    notes.push('brief')
  }
  if (proposal.nav) {
    writeYaml(path.join(root, 'design', 'nav.yml'), proposal.nav)
    notes.push('nav')
  }
  for (const place of proposal.places ?? []) {
    writeYaml(path.join(root, 'content', 'places', `${place.slug}.yml`), place)
    notes.push(`place ${place.slug}`)
  }
  const knownCategories = new Set(
    readEventFields(root).find((field) => field.id === 'categories')?.options.map((option) => option.id) ?? [],
  )
  for (const event of proposal.events ?? []) {
    for (const category of event.categories ?? []) {
      if (knownCategories.size > 0 && !knownCategories.has(category)) throw new Error(`Unknown category ${category}`)
    }
    writeYaml(path.join(root, 'content', 'events', `${event.slug}.yml`), event)
    notes.push(`event ${event.slug}`)
  }
  for (const page of proposal.pages ?? []) {
    pageLayoutsOrThrow(root, page.layout)
    const file = contentPagePath(root, page.slug, page.lang)
    writePageFile(file, {
      layout: page.layout,
      title: page.title,
      date: page.date,
      body: page.body,
      data: { ...(page.fields ?? {}) },
    })
    notes.push(`page ${page.slug} ${page.lang}`)
  }
  if (finish) {
    writeYamlFile(path.join(root, 'design', 'setup.yml'), { accepted: true })
    notes.push('setup accepted')
  }
  return notes.join(', ') || 'nothing changed'
}

function normalizeLanguage(lang: { id: string; label?: string; optional?: boolean }): SiteLanguage | null {
  const id = lang.id.trim().toLowerCase()
  if (!/^[a-z]{2}(?:-[a-z0-9]+)*$/.test(id)) return null
  return { id, label: lang.label?.trim() || id, optional: lang.optional === true }
}

function pagesUsing(root: string, layout: string): string[] {
  const pagesDir = path.join(root, 'content', 'pages')
  if (!fs.existsSync(pagesDir)) return []
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name.endsWith('.md') && fs.readFileSync(file, 'utf8').includes(`layout: ${layout}`)) found.push(file)
    }
  }
  walk(pagesDir)
  return found
}
