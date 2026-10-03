import fs from 'node:fs'
import { contentPagePath, listPageSlugs, readPageFile, readSiteConfig } from '@schlor/generator'

export type NamedPage = { slug: string; title: string }

export function namedPages(root: string): NamedPage[] {
  const language = readSiteConfig(root).languages[0]?.id ?? 'de'
  return listPageSlugs(root).flatMap((slug) => {
    const file = contentPagePath(root, slug, language)
    if (!fs.existsSync(file)) return []
    const title = readPageFile(file, slug, language).title.trim()
    return [{ slug, title }]
  })
}

export function designContentRefusal(rel: string, content: string, pages: NamedPage[]): string | null {
  const normalized = rel.replaceAll('\\', '/')
  const layout = normalized.startsWith('layouts/')
  const shell = normalized === 'shell.njk'
  if (!layout && !shell) return null
  const named = pages.filter((page) => namesPage(content, page))
  if (named.length > 0) {
    const list = named.map((page) => `${page.title} (${page.slug})`).join(', ')
    return `design/${normalized} names ${list}. Give each of those pages its own layout, write its words on the page, and remove it from this file.`
  }
  if (!layout) return null
  if (content.includes('/media/')) {
    return `design/${normalized} holds a picture address. Put the picture on the page. A layout keeps the structure and the look.`
  }
  const prose = pageProse(content)
  if (prose) {
    return `design/${normalized} holds page text (${prose}). Put those words on the page. A layout keeps the structure and the look.`
  }
  return null
}

function namesPage(content: string, page: NamedPage): boolean {
  const hay = content.toLowerCase()
  const slug = page.slug.toLowerCase()
  if (slug.length >= 4 && slug !== 'home' && hasToken(hay, slug)) return true
  if (slug.length >= 8 && hasToken(hay, slug.slice(0, -1))) return true
  const title = page.title.toLowerCase()
  return title.length >= 8 && hay.includes(title)
}

function hasToken(hay: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(hay)
}

function pageProse(content: string): string | null {
  const stripped = content
    .replace(/\{%[\s\S]*?%\}/g, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  const chunks = [
    ...stripped.split(/\n+/),
    ...[...content.matchAll(/['"`]([^'"`\n]{40,})['"`]/g)].map((match) => match[1]),
  ]
  for (const chunk of chunks) {
    const text = chunk.replace(/\s+/g, ' ').trim()
    if (text.split(' ').filter(Boolean).length >= 8) return text.slice(0, 80)
  }
  return null
}

export function guardDesignWrite(root: string, rel: string, content: string): string | null {
  return designContentRefusal(rel, content, namedPages(root))
}
