import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify } from 'yaml'

export type FontFace = {
  family: string
  weight: number
  style: 'normal' | 'italic'
  /** An address in the site: /media/fonts/name.woff2 */
  file: string
  unicodeRange?: string
  /** Load it before the page needs it. For the faces the first screen uses. */
  preload?: boolean
}

const FILE = /^\/media\/fonts\/[A-Za-z0-9._-]+\.woff2$/

/** Read fonts.yml text. Throws a sentence that names the face and the problem. */
export function parseFonts(text: string): FontFace[] {
  let raw: unknown
  try {
    raw = parse(text)
  } catch (error) {
    throw new Error(`fonts.yml is not valid YAML: ${error instanceof Error ? error.message.split('\n')[0] : 'unreadable'}`)
  }
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error('fonts.yml must be a list of font faces')
  return raw.map((item, index) => {
    const where = `fonts.yml face ${index + 1}`
    if (!item || typeof item !== 'object') throw new Error(`${where} must be an object with family, weight, style, and file`)
    const face = item as Record<string, unknown>
    const family = String(face.family ?? '').trim()
    if (!family || /["';{}]/.test(family)) throw new Error(`${where}: family must be a font name such as Source Sans 3`)
    const weight = Number(face.weight ?? 400)
    if (!Number.isInteger(weight) || weight < 100 || weight > 900) throw new Error(`${where}: weight must be 100 to 900, not ${String(face.weight)}`)
    const style = String(face.style ?? 'normal')
    if (style !== 'normal' && style !== 'italic') throw new Error(`${where}: style must be normal or italic`)
    const file = String(face.file ?? '')
    if (!FILE.test(file)) throw new Error(`${where}: file must be a woff2 file in the site, such as /media/fonts/source-sans-3-latin-400-normal.woff2. A font from another host is not allowed.`)
    const unicodeRange = face.unicodeRange === undefined ? undefined : String(face.unicodeRange)
    if (unicodeRange !== undefined && !/^[Uu]\+[0-9A-Fa-f?,\-+\sUu]+$/.test(unicodeRange)) throw new Error(`${where}: unicodeRange must look like U+0000-00FF`)
    return { family, weight, style, file, unicodeRange, preload: face.preload === true }
  })
}

export function readFonts(root: string): FontFace[] {
  const file = path.join(root, 'design', 'fonts.yml')
  return fs.existsSync(file) ? parseFonts(fs.readFileSync(file, 'utf8')) : []
}

export function writeFonts(root: string, faces: FontFace[]): void {
  const plain = faces.map((face) => {
    const out: Record<string, unknown> = { family: face.family, weight: face.weight, style: face.style, file: face.file }
    if (face.unicodeRange) out.unicodeRange = face.unicodeRange
    if (face.preload) out.preload = true
    return out
  })
  fs.writeFileSync(path.join(root, 'design', 'fonts.yml'), stringify(plain, { lineWidth: 0 }))
}

/** @font-face rules. Text shows in a fallback at once and switches when the file has loaded. */
export function fontFaceCss(faces: FontFace[]): string {
  return faces
    .map((face) => {
      const lines = [
        `  font-family: "${face.family}";`,
        `  font-style: ${face.style};`,
        `  font-weight: ${face.weight};`,
        '  font-display: swap;',
        `  src: url("${face.file}") format("woff2");`,
        ...(face.unicodeRange ? [`  unicode-range: ${face.unicodeRange};`] : []),
      ]
      return `@font-face {\n${lines.join('\n')}\n}`
    })
    .join('\n')
}

export function fontPreloadLinks(faces: FontFace[]): string[] {
  const seen = new Set<string>()
  return faces
    .filter((face) => face.preload && !seen.has(face.file) && seen.add(face.file))
    .map((face) => `<link rel="preload" href="${face.file}" as="font" type="font/woff2" crossorigin>`)
}
