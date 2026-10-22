import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

export type Tokens = {
  colors: Record<string, string>
  fonts: Record<string, string>
  radius: Record<string, string>
  widths: Record<string, string>
}

const NAME = /^[a-z][a-z0-9-]*$/
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const LENGTH = /^(?:0|\d*\.?\d+(?:px|rem|em|%))$/

export const TOKEN_GROUPS = ['colors', 'fonts', 'radius', 'widths'] as const

export function emptyTokens(): Tokens {
  return { colors: {}, fonts: {}, radius: {}, widths: {} }
}

/** Read tokens.yml text. Throws a sentence that names the token and the problem. */
export function parseTokens(text: string): Tokens {
  let raw: unknown
  try {
    raw = parse(text)
  } catch (error) {
    throw new Error(`tokens.yml is not valid YAML: ${error instanceof Error ? error.message.split('\n')[0] : 'unreadable'}`)
  }
  const record = (raw ?? {}) as Record<string, unknown>
  if (typeof record !== 'object' || Array.isArray(record)) throw new Error('tokens.yml must have the groups colors, fonts, radius, and widths')
  for (const key of Object.keys(record)) {
    if (!(TOKEN_GROUPS as readonly string[]).includes(key)) throw new Error(`tokens.yml: unknown group ${key}. Use ${TOKEN_GROUPS.join(', ')}.`)
  }
  const tokens = emptyTokens()
  for (const group of TOKEN_GROUPS) {
    const values = record[group]
    if (values === undefined || values === null) continue
    if (typeof values !== 'object' || Array.isArray(values)) throw new Error(`tokens.yml: ${group} must be a list of names and values`)
    for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
      if (!NAME.test(name)) throw new Error(`tokens.yml: ${group}.${name} must be lowercase words with dashes`)
      const text = String(value ?? '').trim()
      if (group === 'colors' && !HEX.test(text)) throw new Error(`tokens.yml: colors.${name} must be a hex color such as #3f6f64, not ${text || 'empty'}`)
      if ((group === 'radius' || group === 'widths') && !LENGTH.test(text)) throw new Error(`tokens.yml: ${group}.${name} must be a length such as 4px or 64rem, not ${text || 'empty'}`)
      if (group === 'fonts' && (!text || /[;{}]/.test(text))) throw new Error(`tokens.yml: fonts.${name} must be a font list such as "Source Sans 3", sans-serif`)
      tokens[group][name] = group === 'colors' ? text.toLowerCase() : text
    }
  }
  return tokens
}

export function readTokens(root: string): Tokens {
  const file = path.join(root, 'design', 'tokens.yml')
  if (!fs.existsSync(file)) return emptyTokens()
  return parseTokens(fs.readFileSync(file, 'utf8'))
}

/** The Tailwind theme these tokens make: text-primary, bg-surface, font-serif, rounded-card, max-w-content. */
export function tokensCss(tokens: Tokens): string {
  const lines = [
    ...Object.entries(tokens.colors).map(([name, value]) => `  --color-${name}: ${value};`),
    ...Object.entries(tokens.fonts).map(([name, value]) => `  --font-${name}: ${value};`),
    ...Object.entries(tokens.radius).map(([name, value]) => `  --radius-${name}: ${value};`),
    ...Object.entries(tokens.widths).map(([name, value]) => `  --container-${name}: ${value};`),
  ]
  return lines.length === 0 ? '' : `@theme {\n${lines.join('\n')}\n}`
}

function rgb(color: string): [number, number, number] {
  const hex = color.slice(1)
  const full = hex.length === 3 ? [...hex].map((char) => char + char).join('') : hex
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as [number, number, number]
}

function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((value) => {
    const unit = value / 255
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return Math.round(((light + 0.05) / (dark + 0.05)) * 10) / 10
}

// Pairs that must read well: a text color over the color it is used on.
const PAIRS: [string, string][] = [
  ['ink', 'page'],
  ['muted', 'page'],
  ['heading', 'page'],
  ['link', 'page'],
  ['on-primary', 'primary'],
  ['on-accent', 'accent'],
  ['on-surface', 'surface'],
  ['on-dark', 'dark'],
]

export function contrastWarnings(tokens: Tokens): string[] {
  return PAIRS.flatMap(([text, ground]) => {
    const a = tokens.colors[text]
    const b = tokens.colors[ground]
    if (!a || !b) return []
    const ratio = contrastRatio(a, b)
    return ratio < 4.5 ? [`${text} (${a}) on ${ground} (${b}) has contrast ${ratio}:1 and needs 4.5:1.`] : []
  })
}

/** The token whose color is nearest to this one, and whether it is the same color. */
export function nearestColor(tokens: Tokens, color: string): { name: string; value: string; exact: boolean } | null {
  const normalized = color.length === 4 ? `#${[...color.slice(1)].map((char) => char + char).join('')}` : color.toLowerCase()
  if (!HEX.test(normalized)) return null
  const [r, g, b] = rgb(normalized)
  let best: { name: string; value: string; distance: number } | null = null
  for (const [name, value] of Object.entries(tokens.colors)) {
    const [tr, tg, tb] = rgb(value)
    const distance = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2
    if (!best || distance < best.distance) best = { name, value, distance }
  }
  return best ? { name: best.name, value: best.value, exact: best.distance === 0 } : null
}

/** What goes into the prompt: the tokens in a few lines. */
export function tokenSummary(tokens: Tokens): string {
  const part = (label: string, values: Record<string, string>) => {
    const entries = Object.entries(values)
    return entries.length === 0 ? '' : `${label}: ${entries.map(([name, value]) => `${name} ${value}`).join(', ')}`
  }
  const lines = [part('Colors', tokens.colors), part('Fonts', tokens.fonts), part('Radius', tokens.radius), part('Widths', tokens.widths)].filter(Boolean)
  return lines.join('\n')
}
