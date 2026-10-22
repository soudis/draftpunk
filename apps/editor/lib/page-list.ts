import { listPageSlugs, pageUrl, readPage, readSiteConfig } from '@schlor/generator'
import type { PageEntry } from './page-match'

/** Every page of the site with its title and its address in each language. The home page comes first. */
export function pageEntries(root: string): PageEntry[] {
  const site = readSiteConfig(root)
  const entries = listPageSlugs(root).flatMap((slug) => {
    const page = readPage(root, slug)
    if (!page) return []
    const title = site.languages.map((language) => page.title[language.id]?.trim()).find(Boolean) || Object.values(page.title).find((text) => text?.trim()) || slug
    const urls: Record<string, string> = {}
    for (const language of site.languages) urls[language.id] = pageUrl(slug, language.id, site)
    return [{ slug, title, urls }]
  })
  return entries.sort((a, b) => (a.slug === 'home' ? -1 : b.slug === 'home' ? 1 : a.title.localeCompare(b.title)))
}
