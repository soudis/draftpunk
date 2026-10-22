import fs from 'node:fs'
import path from 'node:path'
import { parseTokens, readFonts, writeFonts, writeTokens, type FontFace } from '@schlor/generator'
import { safeFetch } from './safe-fetch'
import { fail } from './tool-kit'
import type { FetchPage } from './web-render'

const API = 'https://api.fontsource.org/v1/fonts'
const LICENSES = new Set(['OFL-1.1', 'Apache-2.0', 'MIT', 'UFL-1.0'])

type Catalog = {
  id: string
  family: string
  subsets: string[]
  weights: number[]
  styles: string[]
  category: string
  license: string
  unicodeRange?: Record<string, string>
  variants: Record<string, Record<string, Record<string, { url: { woff2: string } }>>>
}

const FALLBACK: Record<string, string> = {
  'sans-serif': 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  monospace: 'ui-monospace, monospace',
  display: 'ui-sans-serif, system-ui, sans-serif',
  handwriting: 'ui-sans-serif, system-ui, sans-serif',
}

export function fontId(family: string): string {
  return family.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function bytes(fetchPage: FetchPage, url: string, max: number): Promise<Buffer> {
  const response = await fetchPage(url, { maxBytes: max, redirect: 'manual' })
  let current = response
  for (let hop = 0; hop < 3 && current.status >= 300 && current.status < 400; hop += 1) {
    const location = current.headers.get('location')
    if (!location) break
    current = await fetchPage(new URL(location, url).href, { maxBytes: max, redirect: 'manual' })
  }
  if (!current.ok) fail(`Could not download ${url} (HTTP ${current.status}).`)
  return Buffer.from(await current.arrayBuffer())
}

/**
 * Download an open-licence family once, here on the server, into the site. A visitor then loads the font from the
 * site and contacts no one else. Returns what was added and how to use it.
 */
export async function addFont(
  root: string,
  input: { family: string; weights?: number[]; italic?: boolean; subsets?: string[]; as?: string; preload?: boolean },
  fetchPage: FetchPage = safeFetch,
): Promise<string> {
  const id = fontId(input.family)
  if (!id) fail('family is required, such as Lora.')
  if (input.as !== undefined && !/^[a-z][a-z0-9-]*$/.test(input.as)) fail(`as must be a token name such as sans or serif, not ${input.as}. Nothing was added.`)
  let catalog: Catalog
  try {
    const response = await fetchPage(`${API}/${id}`, { maxBytes: 4_000_000, redirect: 'manual' })
    if (response.status === 404) fail(`No font named ${input.family} in the open fonts catalog (Fontsource). Check the spelling, or choose another family.`)
    if (!response.ok) fail(`The fonts catalog answered HTTP ${response.status}. Try again later.`)
    catalog = (await response.json()) as Catalog
  } catch (error) {
    if (error instanceof Error && error.name === 'ToolError') throw error
    fail(`Could not reach the fonts catalog: ${error instanceof Error ? error.message : 'unknown error'}.`)
  }
  if (!LICENSES.has(catalog.license)) fail(`${catalog.family} has the licence ${catalog.license}, which is not one of the open licences this site allows (${[...LICENSES].join(', ')}).`)
  const weights = input.weights && input.weights.length > 0 ? input.weights : [400, 700].filter((weight) => catalog.weights.includes(weight))
  const missingWeight = weights.filter((weight) => !catalog.weights.includes(weight))
  if (weights.length === 0 || missingWeight.length > 0) fail(`${catalog.family} has the weights ${catalog.weights.join(', ')}${missingWeight.length ? `, not ${missingWeight.join(', ')}` : ''}.`)
  const subsets = input.subsets && input.subsets.length > 0 ? input.subsets : ['latin']
  const missingSubset = subsets.filter((subset) => !catalog.subsets.includes(subset))
  if (missingSubset.length > 0) fail(`${catalog.family} has the subsets ${catalog.subsets.join(', ')}, not ${missingSubset.join(', ')}.`)
  const styles = input.italic && catalog.styles.includes('italic') ? ['normal', 'italic'] : ['normal']
  if (input.italic && !catalog.styles.includes('italic')) fail(`${catalog.family} has no italic.`)

  const folder = path.join(root, 'media', 'fonts')
  fs.mkdirSync(folder, { recursive: true })
  const faces = readFonts(root)
  const added: FontFace[] = []
  const nearest400 = weights.reduce((best, weight) => (Math.abs(weight - 400) < Math.abs(best - 400) ? weight : best), weights[0])
  for (const subset of subsets) {
    for (const weight of weights) {
      for (const style of styles) {
        const url = catalog.variants[String(weight)]?.[style]?.[subset]?.url?.woff2
        if (!url) fail(`${catalog.family} has no ${style} ${weight} file for ${subset}.`)
        const name = `${id}-${subset}-${weight}-${style}.woff2`
        const file = path.join(folder, name)
        if (!fs.existsSync(file)) {
          const data = await bytes(fetchPage, url, 700_000)
          if (data.subarray(0, 4).toString('latin1') !== 'wOF2') fail(`The file for ${catalog.family} ${weight} ${style} is not a woff2 font.`)
          fs.writeFileSync(file, data)
        }
        added.push({
          family: catalog.family,
          weight,
          style: style as 'normal' | 'italic',
          file: `/media/fonts/${name}`,
          unicodeRange: catalog.unicodeRange?.[subset],
          preload: input.preload !== false && weight === nearest400 && style === 'normal' && subset === subsets[0],
        })
      }
    }
  }
  const kept = faces.filter((face) => !added.some((face2) => face2.file === face.file))
  writeFonts(root, [...kept, ...added])
  const notes = [`Added ${catalog.family} (${weights.join(', ')}${input.italic ? ', with italic' : ''}; ${subsets.join(', ')}) as ${added.length} files in media/fonts. Licence ${catalog.license}. Nothing is loaded from another host.`]
  if (input.as) {
    const tokensFile = path.join(root, 'design', 'tokens.yml')
    const tokens = parseTokens(fs.existsSync(tokensFile) ? fs.readFileSync(tokensFile, 'utf8') : '')
    tokens.fonts[input.as] = `"${catalog.family}", ${FALLBACK[catalog.category] ?? FALLBACK['sans-serif']}`
    writeTokens(root, tokens)
    notes.push(`Set the font token ${input.as} to ${catalog.family}. Use font-${input.as} in a class or var(--font-${input.as}) in CSS.`)
  } else {
    notes.push(`To use it, set a font token in tokens.yml, for example fonts: { serif: '"${catalog.family}", ui-serif, serif' }, or call add_font again with as.`)
  }
  return notes.join(' ')
}

/** Font tokens whose first family has no file in fonts.yml, so the browser would fall back to something else. */
export function tokenFontsWithoutFiles(root: string, tokenFonts: Record<string, string>): string[] {
  const available = new Set(readFonts(root).map((face) => face.family.toLowerCase()))
  return Object.entries(tokenFonts).flatMap(([name, list]) => {
    const first = list.split(',')[0].trim().replace(/^["']|["']$/g, '')
    const generic = /^(?:-apple-system|blinkmacsystemfont|system-ui|ui-[a-z-]+|serif|sans-serif|monospace|segoe ui|roboto|helvetica neue|arial|georgia|times new roman|courier new|verdana)$/i.test(first)
    return generic || available.has(first.toLowerCase()) ? [] : [`fonts.${name} is ${first}, which has no file in fonts.yml, so visitors would see a fallback font. Call add_font with family ${first}.`]
  })
}
