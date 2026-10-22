import { nearestColor, type Tokens } from '@schlor/generator'

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const UTILITIES = 'bg|text|border|from|to|via|ring|fill|stroke|divide|outline|decoration|accent|caret|shadow|placeholder'
const PALETTE_CLASS = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${UTILITIES})-(?:${PALETTE})-\\d{2,3}(?:/\\d+)?(?![\\w-])`, 'g')
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g
const COLOR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\([^)]*\)/gi
const GENERIC_FONTS = new Set(['inherit', 'initial', 'unset', 'serif', 'sans-serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'cursive', 'fantasy', 'emoji', 'math'])
const NO_COLOR_PROPERTIES = /^(?:box-shadow|text-shadow|filter|backdrop-filter|drop-shadow)$/

function kindOf(rel: string): 'template' | 'style' | null {
  const normalized = rel.replaceAll('\\', '/')
  if (normalized === 'shell.njk' || /^layouts\/[^/]+\/template\.njk$/.test(normalized)) return 'template'
  if (normalized === 'styles.css' || /^layouts\/[^/]+\/style\.css$/.test(normalized)) return 'style'
  return null
}

function colorAdvice(tokens: Tokens, color: string): string {
  if (/^#/.test(color)) {
    const near = nearestColor(tokens, color)
    if (near?.exact) return `${color} is the ${near.name} color. Use var(--color-${near.name}) in CSS, or bg-${near.name}, text-${near.name} or border-${near.name} in a class.`
    if (near) return `${color} is not a token color. The nearest is ${near.name} (${near.value}): use var(--color-${near.name}), or add a color to tokens.yml.`
  }
  return `${color} is a color value that is not a token. Use var(--color-name) with a color from tokens.yml, or add one.`
}

function cssFindings(css: string, tokens: Tokens, found: Set<string>): void {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const families = Object.values(tokens.fonts).flatMap((list) => firstFamilies(list))
  for (const declaration of stripped.matchAll(/(?:^|[;{\s])((?:--)?[a-z-]+)\s*:\s*([^;{}]+)/g)) {
    const [, property, value] = declaration
    if (NO_COLOR_PROPERTIES.test(property)) continue
    const bare = value.replace(/var\([^)]*\)/g, '')
    for (const color of [...(bare.match(HEX) ?? []), ...(bare.match(COLOR_FN) ?? [])]) found.add(colorAdvice(tokens, color))
    if (property === 'font-family') {
      const first = firstFamilies(value)[0]
      if (first && !/^var\(/.test(value.trim()) && !GENERIC_FONTS.has(first.toLowerCase()) && !families.some((family) => family.toLowerCase() === first.toLowerCase())) {
        found.add(`font-family ${first} is not a token font. Use font-sans or font-serif (var(--font-sans)), or add the font to tokens.yml.`)
      }
    }
  }
}

function firstFamilies(list: string): string[] {
  return list
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .slice(0, 1)
}

/** What a design file does that the tokens are there to prevent. Advice, never a refusal. */
export function lintDesign(rel: string, content: string, tokens: Tokens): string[] {
  const kind = kindOf(rel)
  if (!kind || Object.keys(tokens.colors).length === 0) return []
  const found = new Set<string>()
  if (kind === 'style') {
    cssFindings(content, tokens, found)
  } else {
    const noComments = content.replace(/\{#[\s\S]*?#\}/g, '')
    for (const tag of noComments.matchAll(/<[a-z][^>]*>/gi)) {
      const style = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag[0])?.[2]
      if (style) {
        if (/(?:color|background|font)/i.test(style) && !/^\s*(?:--[\w-]+\s*:[^;]*;?\s*)+$/.test(style)) found.add('An inline style sets a color, background, or font. Move it to the layout’s style.css, using tokens.')
        cssFindings(style, tokens, found)
      }
      for (const attribute of tag[0].matchAll(/\s(?:fill|stroke|stop-color|color)\s*=\s*(["'])(#[0-9a-fA-F]{3,8})\1/g)) found.add(colorAdvice(tokens, attribute[2]))
      for (const arbitrary of tag[0].matchAll(/\[(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})|(?:rgba?|hsla?|oklch)\([^\])]*\))\]/g)) found.add(colorAdvice(tokens, arbitrary[1]))
      for (const font of tag[0].matchAll(/\bfont-\[['"]?([^\]'"]+)['"]?\]/g)) found.add(`font-[${font[1]}] is not a token font. Use font-sans or font-serif, or add the font to tokens.yml.`)
    }
    for (const match of noComments.matchAll(PALETTE_CLASS)) {
      const name = match[0]
      const role = name.split(':').pop()?.split('-')[0] ?? 'bg'
      found.add(`${name} is a color from the default palette. Use a token color, such as ${role}-primary, ${role}-accent, or ${role}-surface.`)
    }
    for (const style of noComments.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) cssFindings(style[1], tokens, found)
  }
  return [...found].slice(0, 6)
}

/** Findings that the new text has and the old text did not, so an old problem is not told again with every change. */
export function newFindings(before: string[], after: string[]): string[] {
  const known = new Set(before)
  return after.filter((finding) => !known.has(finding))
}
