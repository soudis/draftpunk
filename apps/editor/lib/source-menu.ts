import path from 'node:path'
import { pageUrl, readSiteConfig, readYaml, writeYaml } from '@schlor/generator'
import { listPageSlugs, readPage } from '@schlor/generator'
import { normalPath, recordPath, slugFor, splitLanguage } from './import-pages'

export type MenuEntry = { label: string; href: string; children: { label: string; href: string }[] }
type Nav = { href: string; label: Record<string, string>; children?: Nav[] }

// Runs inside the page. A string, not a function, so a build step cannot rewrite it. It reads the structure of the
// main navigation as it is in the page, hidden sub-entries included: a nested list, or a group of links in a box.
export const MENU_SOURCE = `(() => {
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
  const usable = (a) => a && a.href && /^https?:/i.test(a.href) && !(a.getAttribute('href') || '').startsWith('#') && clean(a.textContent)
  const link = (a) => ({ label: clean(a.textContent), href: a.href })
  const shown = (el) => el.getBoundingClientRect().height > 0
  const entriesOf = (list) => {
    const entries = []
    for (const item of [...list.children].filter((el) => el.tagName === 'LI')) {
      // The entry's own link is the first one that belongs to this item and not to a list nested in it.
      const direct = [...item.querySelectorAll('a[href]')].find((a) => a.closest('li') === item)
      if (!usable(direct)) continue
      const nested = [...item.querySelectorAll('li a[href]')].filter((a) => a !== direct && a.closest('li') !== item && usable(a))
      entries.push({ ...link(direct), children: nested.map(link) })
    }
    return entries
  }
  // The main menu is the top-level list in a header or a navigation with the most links, a shown one before a hidden
  // copy of it (themes keep one for a phone), and one with nested lists before one without.
  const candidates = [...document.querySelectorAll('ul, ol')].filter(
    (ul) => !ul.closest('footer') && !(ul.parentElement && ul.parentElement.closest('li')) && ul.closest('nav, header, [role="navigation"]'),
  )
  const score = (ul) => ul.querySelectorAll('a[href]').length + (shown(ul) ? 60 : 0) + (ul.querySelector('li ul, li ol') ? 20 : 0) + (ul.closest('header') ? 10 : 0)
  candidates.sort((a, b) => score(b) - score(a))
  for (const list of candidates) {
    const entries = entriesOf(list)
    if (entries.length >= 2) return entries
  }
  // No list: links, and groups of links in a box, directly in a navigation.
  const navs = [...document.querySelectorAll('nav, [role="navigation"]')].filter((nav) => !nav.closest('footer'))
  navs.sort((a, b) => b.querySelectorAll('a[href]').length - a.querySelectorAll('a[href]').length)
  const entries = []
  for (const child of navs[0] ? navs[0].children : []) {
    if (child.tagName === 'A') {
      if (usable(child)) entries.push({ ...link(child), children: [] })
      continue
    }
    const links = [...child.querySelectorAll('a[href]')].filter(usable)
    if (links.length > 0) entries.push({ ...link(links[0]), children: links.slice(1).map(link) })
  }
  return entries
})()`

type Resolver = (path: string, label?: string) => string | null

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
    const slugUrl = options.resolve(normalPath(url.pathname), label)
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

const plain = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The page of this site that a source address became: one imported by import_pages, the home page, a page named
 * after the address or after its last part, or the one page whose title is the words of the menu entry. The pages
 * of the first pass have names of the agent's own, so the last two are what finds them.
 */
export function resolverFor(root: string): Resolver {
  const site = readSiteConfig(root)
  const languages = site.languages.map((language) => language.id)
  const record = readYaml<{ pages?: Record<string, string> }>(recordPath(root), {}).pages ?? {}
  const slugs = new Set(listPageSlugs(root))
  const byTitle = new Map<string, string[]>()
  for (const slug of slugs) {
    const page = readPage(root, slug)
    for (const title of Object.values(page?.title ?? {})) {
      const key = plain(title)
      if (key) byTitle.set(key, [...new Set([...(byTitle.get(key) ?? []), slug])])
    }
  }
  return (address, label) => {
    const { rest } = splitLanguage(address, languages)
    if (rest === '/' && slugs.has('home')) return pageUrl('home', languages[0], site)
    const last = rest.split('/').filter(Boolean).pop() ?? ''
    const named = [record[address], record[rest], slugFor(rest), slugFor(last)].find((slug) => slug && slugs.has(slug))
    if (named) return pageUrl(named, languages[0], site)
    const titled = label ? byTitle.get(plain(label)) : undefined
    return titled?.length === 1 ? pageUrl(titled[0], languages[0], site) : null
  }
}

export function writeMenu(root: string, menu: Nav[]): void {
  const file = path.join(root, 'design', 'nav.yml')
  const current = readYaml<{ menu?: unknown; footer?: unknown } | unknown[]>(file, {})
  const footer = Array.isArray(current) ? [] : (current.footer ?? [])
  writeYaml(file, { menu, footer })
}
