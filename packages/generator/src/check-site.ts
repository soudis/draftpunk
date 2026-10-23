import fs from 'node:fs'
import path from 'node:path'

type Missing = { picture: string; pages: string[] }

function pagesOf(dir: string, base = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) return entry.name === 'media' || entry.name === 'assets' ? [] : pagesOf(path.join(dir, entry.name), rel)
    return entry.name.endsWith('.html') ? [rel] : []
  })
}

const addressOf = (file: string) => (file === 'index.html' ? '/' : `/${file.replace(/index\.html$/, '')}`)

function exists(outDir: string, target: string): boolean {
  const clean = decodeURI(target)
  const file = path.join(outDir, clean)
  if (path.relative(outDir, file).startsWith('..')) return false
  if (clean.endsWith('/')) return fs.existsSync(path.join(file, 'index.html'))
  return fs.existsSync(file) && fs.statSync(file).isFile() ? true : fs.existsSync(path.join(file, 'index.html'))
}

const few = (items: string[], limit = 8) => (items.length <= limit ? items.join(', ') : `${items.slice(0, limit).join(', ')} and ${items.length - limit} more`)

/**
 * What is wrong with a generated site as a whole, found without a browser: links and pictures that lead nowhere,
 * pages without exactly one main heading, the same title twice, pages nothing links to, pictures with no alt text.
 * A page answers for the whole site; the agent runs this before it says an import is done.
 */
export function checkSite(outDir: string, missingAlt: Missing[] = []): string {
  const files = pagesOf(outDir).filter((file) => !/(^|\/)404\.html$/.test(file))
  const pages = files.map((file) => ({ file, address: addressOf(file), html: fs.readFileSync(path.join(outDir, file), 'utf8') })).filter((page) => !/http-equiv=["']refresh["']/i.test(page.html))
  // A link from the other language does not count: the language switch links every page to its twin.
  const languageOf = new Map(pages.map((page) => [page.address, /<html[^>]*\blang=["']([^"']+)/i.exec(page.html)?.[1] ?? ''] as const))
  const dead = new Map<string, Set<string>>()
  const inbound = new Map<string, number>()
  const titles = new Map<string, string[]>()
  const noHeading: string[] = []
  const noDescription: string[] = []
  for (const page of pages) {
    const lang = languageOf.get(page.address) ?? ''
    const title = /<title>([\s\S]*?)<\/title>/i.exec(page.html)?.[1].trim() ?? ''
    if (!/name=["']robots["'][^>]*noindex/i.test(page.html)) titles.set(`${lang}|${title}`, [...(titles.get(`${lang}|${title}`) ?? []), page.address])
    const headings = (page.html.match(/<h1\b/gi) ?? []).length
    if (headings !== 1 && !/name=["']robots["'][^>]*noindex/i.test(page.html)) noHeading.push(`${page.address} (${headings})`)
    if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10}/i.test(page.html) && !/name=["']robots["'][^>]*noindex/i.test(page.html)) noDescription.push(page.address)
    const targets = [
      ...[...page.html.matchAll(/<a\b[^>]*\shref\s*=\s*"([^"]*)"/gi)].map((match) => ({ target: match[1], link: true })),
      ...[...page.html.matchAll(/<(?:img|source|script)\b[^>]*\ssrc\s*=\s*"([^"]*)"/gi)].map((match) => ({ target: match[1], link: false })),
      ...[...page.html.matchAll(/<link\b[^>]*\srel=["'](?:stylesheet|icon)["'][^>]*\shref\s*=\s*"([^"]*)"/gi)].map((match) => ({ target: match[1], link: false })),
    ]
    for (const { target, link } of targets) {
      if (!target.startsWith('/') || target.startsWith('//')) continue
      const clean = target.split(/[?#]/)[0]
      if (!clean) continue
      if (!exists(outDir, clean)) dead.set(clean, (dead.get(clean) ?? new Set()).add(page.address))
      else if (link && clean !== page.address && languageOf.get(clean) === lang) inbound.set(clean, (inbound.get(clean) ?? 0) + 1)
    }
  }
  const lines: string[] = []
  if (dead.size > 0) {
    lines.push(`Links and files that lead nowhere (${dead.size}):`, ...[...dead.entries()].slice(0, 12).map(([target, from]) => `- ${target} — on ${few([...from].sort(), 4)}`))
  }
  if (noHeading.length > 0) lines.push(`Pages without exactly one main heading (${noHeading.length}): ${few(noHeading)}`)
  if (noDescription.length > 0) lines.push(`Pages without a description for search results (${noDescription.length}): ${few(noDescription)}`)
  const repeated = [...titles.entries()].filter(([, shown]) => shown.length > 1)
  if (repeated.length > 0) lines.push(`The same title on several pages (${repeated.length}):`, ...repeated.slice(0, 6).map(([key, shown]) => `- "${key.split('|').slice(1).join('|')}" — ${few(shown, 4)}`))
  const orphans = pages.filter((page) => !/name=["']robots["'][^>]*noindex/i.test(page.html) && !/^\/(?:[a-z]{2}\/)?(?:(?:blog|events)\/)?$/.test(page.address) && !inbound.get(page.address)).map((page) => page.address)
  if (orphans.length > 0) lines.push(`Pages no other page links to (${orphans.length}): ${few(orphans)}`)
  if (missingAlt.length > 0) {
    lines.push(
      `Pictures that say nothing about themselves, with an empty alt text (${missingAlt.length}). Run describe_pictures, or set_picture_alt for a decoration:`,
      ...missingAlt.slice(0, 12).map((entry) => `- ${entry.picture} — on ${entry.pages.length} ${entry.pages.length === 1 ? 'page' : 'pages'}`),
    )
    if (missingAlt.length > 12) lines.push(`… and ${missingAlt.length - 12} more.`)
  }
  return lines.length === 0 ? `No problems found in ${pages.length} pages.` : [`${pages.length} pages checked.`, ...lines].join('\n')
}
