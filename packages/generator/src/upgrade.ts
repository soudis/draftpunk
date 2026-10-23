import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { GENERATED_LAYOUTS, layoutExists, layoutFolder } from './layouts'

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed')

/**
 * A site made before a generated page existed (the search, say) has no design for it, and so no page. The design of a site is
 * its own, so nothing is overwritten: a generated layout the site lacks is copied from the starter, and so are the labels it
 * needs that the site has no text for. A file or a label the site has is never touched.
 */
export function upgradeDesign(root: string): { layouts: string[]; labels: string[] } {
  const design = path.join(root, 'design')
  const added = { layouts: [] as string[], labels: [] as string[] }
  if (!fs.existsSync(path.join(design, 'shell.njk'))) return added
  for (const name of GENERATED_LAYOUTS) {
    const from = path.join(seedDir, 'design', 'layouts', name)
    if (layoutExists(design, name) || !fs.existsSync(from)) continue
    fs.cpSync(from, layoutFolder(design, name), { recursive: true })
    added.layouts.push(name)
  }
  const own = path.join(design, 'labels.yml')
  const starter = path.join(seedDir, 'design', 'labels.yml')
  if (fs.existsSync(own) && fs.existsSync(starter)) {
    const have = parse(fs.readFileSync(own, 'utf8')) as Record<string, unknown> | null
    const wanted = parse(fs.readFileSync(starter, 'utf8')) as Record<string, unknown> | null
    const missing = Object.entries(wanted ?? {}).filter(([key]) => !Object.prototype.hasOwnProperty.call(have ?? {}, key))
    if (missing.length > 0) {
      const text = fs.readFileSync(own, 'utf8')
      fs.appendFileSync(own, `${text.endsWith('\n') ? '' : '\n'}${stringify(Object.fromEntries(missing))}`)
      added.labels.push(...missing.map(([key]) => key))
    }
  }
  return added
}

function starterBlock(pattern: RegExp): string | undefined {
  try {
    return pattern.exec(fs.readFileSync(path.join(seedDir, 'design', 'shell.njk'), 'utf8'))?.[0]
  } catch {
    return undefined
  }
}

/**
 * What the starter's shell has that this site's shell lacks, as advice for the agent: the parts of a design that a file copy
 * cannot add, because the site's shell is its own. Each line says what is missing and holds the starter's lines to put in.
 */
export function upgradeAdvice(root: string, hasSubmenus: boolean): string[] {
  const design = path.join(root, 'design')
  let shell: string
  try {
    shell = fs.readFileSync(path.join(design, 'shell.njk'), 'utf8')
  } catch {
    return []
  }
  const advice: string[] = []
  if (layoutExists(design, 'search') && !/site-search|\{%\s*if\s+search\s*%\}/.test(shell)) {
    const block = starterBlock(/\{% if search %\}[\s\S]*?\{% endif %\}/)
    if (block) advice.push(`The site has a search page but its header has no search field. Put this in the menu of design/shell.njk, after the links:\n${block}`)
  }
  if (hasSubmenus && !/breadcrumbs/.test(shell)) {
    const block = starterBlock(/\{% if breadcrumbs and breadcrumbs\.length > 2 %\}[\s\S]*?<\/nav>\s*\{% endif %\}/)
    if (block) advice.push(`Pages under a menu parent and posts can show the way down to them. Put this in design/shell.njk just before <main>:\n${block}`)
  }
  return advice
}
