import fs from 'node:fs'
import path from 'node:path'
import { renderContent } from './content'
import { pageOutputFile } from './generate'
import { layoutExists, readLayout } from './layouts'
import { readSiteConfig } from './model'
import { listPageSlugs, pageHasLanguage, readPage } from './pages'
import { slotTexts } from './slots'

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|[a-z]+);/gi, (entity, dec: string | undefined, hex: string | undefined) => {
      if (dec) return String.fromCodePoint(Number(dec))
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
      return ENTITIES[entity.toLowerCase()] ?? entity
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Words a person wrote in a slot that the generated page does not show. A layout change that
 * drops a slot, or hides it, shows up here. Reads the pages as generated, so call it after generate.
 */
export function lostContent(root: string, outDir = path.join(root, 'dist')): string[] {
  const designDir = path.join(root, 'design')
  const site = readSiteConfig(root)
  const lost: string[] = []
  for (const slug of listPageSlugs(root)) {
    const page = readPage(root, slug)
    if (!page || !layoutExists(designDir, page.layout)) continue
    const layout = readLayout(designDir, page.layout)
    const texts = slotTexts(layout.slots, page.slots)
    for (const language of site.languages) {
      if (!pageHasLanguage(page, language.id)) continue
      const file = pageOutputFile(root, outDir, slug, language.id)
      const shown = fs.existsSync(file) ? visibleText(fs.readFileSync(file, 'utf8')) : ''
      const missing = texts
        .filter((item) => item.lang === undefined || item.lang === language.id)
        .filter((item) => {
          const expected = visibleText(isMarkdownPath(item.path, layout.slots) ? renderContent(item.text) : escapeText(item.text))
          return expected.length > 0 && !shown.includes(expected)
        })
      if (missing.length > 0) lost.push(`${slug} (${language.id}): ${missing.map((item) => item.path.replace(/\.[a-z]{2}(?:-[a-z0-9]+)*$/, '')).join(', ')}`)
    }
  }
  return lost
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Markdown slots are rendered to HTML before they are shown; plain text slots are printed as they are.
function isMarkdownPath(slotPath: string, schema: Record<string, import('./slots').SlotDef>): boolean {
  const parts = slotPath.split('.').slice(1)
  let def: import('./slots').SlotDef | undefined = schema[parts[0]]
  for (const part of parts.slice(1)) {
    if (!def) return false
    if (def.type === 'list' && /^\d+$/.test(part)) def = def.of
    else if (def.type === 'group') def = def.fields?.[part]
    else if (def.translate && /^[a-z]{2}(?:-[a-z0-9]+)*$/.test(part)) continue
  }
  return def?.type === 'markdown'
}
