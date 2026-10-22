import path from 'node:path'
import { pageUrl, readSiteConfig, readYaml, writeYaml } from '@schlor/generator'
import { listPageSlugs } from '@schlor/generator'
import { normalPath, recordPath, slugFor, splitLanguage } from './import-pages'

export type MenuEntry = { label: string; href: string; children: { label: string; href: string }[] }
type Nav = { href: string; label: Record<string, string>; children?: Nav[] }

// Runs inside the page. A string, not a function, so a build step cannot rewrite it. It reads the structure of the
// main navigation as it is in the page, hidden sub-entries included: a nested list, or a group of links in a box.
export const MENU_SOURCE = `(() => {
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
  const usable = (a) => a && a.href && /^https?:/i.test(a.href) && !(a.getAttribute('href') || '').startsWith('#') && clean(a.textContent)
  const link = (a) => ({ label: clean(a.textContent), href: a.href })
  const navs = [...document.querySelectorAll('nav, [role="navigation"]')].filter((nav) => !nav.closest('footer'))
  const score = (nav) => nav.querySelectorAll('a[href]').length + (nav.closest('header') ? 100 : 0)
  navs.sort((a, b) => score(b) - score(a))
  const nav = navs[0]
  if (!nav) return []
  const entries = []
  const list = nav.querySelector('ul')
  if (list) {
    const top = [...list.children].filter((el) => el.tagName === 'LI')
    for (const item of top) {
      // The entry's own link is the first one that belongs to this item and not to a list nested in it.
      const direct = [...item.querySelectorAll('a[href]')].find((a) => a.closest('li') === item)
      if (!usable(direct)) continue
      const nested = [...item.querySelectorAll('li a[href]')].filter((a) => a !== direct && a.closest('li') !== item && usable(a))
      entries.push({ ...link(direct), children: nested.map(link) })
    }
    return entries
  }
  for (const child of nav.children) {
    if (child.tagName === 'A') {
      if (usable(child)) entries.push({ ...link(child), children: [] })
      continue
    }
    const links = [...child.querySelectorAll('a[href]')].filter(usable)
    if (links.length > 0) entries.push({ ...link(links[0]), children: links.slice(1).map(link) })
  }
  return entries
})()`

type Resolver = (path: string) => string | null

/** What the source's menu becomes: entries that point to pages of this site, outbound links as they are, and what has no page. */
export function buildNav(
  menus: Record<string, MenuEntry[]>,
  options: { origin: string; languages: string[]; resolve: Resolver },
): { menu: Nav[]; left: string[]; copied: string[] } {
  const [defaultLang] = options.languages
  const base = menus[defaultLang] ?? []
  const left: string[] = []
  const copied: string[] = []
  const sameShape = (other: MenuEntry[]) => other.length === base.length && other.every((entry, index) => entry.children.length === base[index].children.length)
  const labels = (lang: string, get: (entry: MenuEntry) => string, index: number) => get(menus[lang]?.[index] ?? base[index])
  const target = (href: string, label: string): string | null => {
    let url: URL
    try {
      url = new URL(href)
    } catch {
      return null
    }
    if (url.origin !== options.origin) return href
    const slugUrl = options.resolve(normalPath(url.pathname))
    if (!slugUrl) {
      left.push(`${normalPath(url.pathname)} — ${label}`)
      return null
    }
    return slugUrl
  }
  const useful = options.languages.filter((lang) => lang === defaultLang || (menus[lang] && sameShape(menus[lang])))
  for (const lang of options.languages) if (!useful.includes(lang)) copied.push(lang)
  const menu: Nav[] = []
  base.forEach((entry, index) => {
    const label: Record<string, string> = {}
    for (const lang of options.languages) label[lang] = useful.includes(lang) ? labels(lang, (item) => item.label, index) : entry.label
    const children: Nav[] = []
    entry.children.forEach((child, childIndex) => {
      const href = target(child.href, child.label)
      if (!href) return
      const childLabel: Record<string, string> = {}
      for (const lang of options.languages) childLabel[lang] = useful.includes(lang) ? (menus[lang]?.[index]?.children[childIndex]?.label ?? child.label) : child.label
      children.push({ href, label: childLabel })
    })
    const own = target(entry.href, entry.label)
    const href = own ?? children[0]?.href
    if (!href) return
    menu.push(children.length > 0 ? { href, label, children } : { href, label })
  })
  return { menu, left, copied }
}

/** The page of this site that a source address became: imported by import_pages, or a page named after the address. */
export function resolverFor(root: string): Resolver {
  const site = readSiteConfig(root)
  const languages = site.languages.map((language) => language.id)
  const record = readYaml<{ pages?: Record<string, string> }>(recordPath(root), {}).pages ?? {}
  const slugs = new Set(listPageSlugs(root))
  return (address) => {
    const { lang, rest } = splitLanguage(address, languages)
    if (rest === '/' && slugs.has('home')) return pageUrl('home', languages[0], site)
    const slug = record[address] ?? record[rest] ?? (slugs.has(slugFor(rest)) ? slugFor(rest) : undefined)
    return slug && slugs.has(slug) ? pageUrl(slug, languages[0], site) : null
  }
}

export function writeMenu(root: string, menu: Nav[]): void {
  const file = path.join(root, 'design', 'nav.yml')
  const current = readYaml<{ menu?: unknown; footer?: unknown } | unknown[]>(file, {})
  const footer = Array.isArray(current) ? [] : (current.footer ?? [])
  writeYaml(file, { menu, footer })
}
