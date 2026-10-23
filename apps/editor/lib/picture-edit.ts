import sharp, { type OverlayOptions, type Sharp } from 'sharp'
import { editSvg, svgBox, type SvgBox } from '@schlor/generator'
import type { PictureKind } from './pictures'

/**
 * Edits of a raster picture, as small operations the model names and this file carries out. The model never counts pixels:
 * a crop is in percent of the picture, a colour is a colour, and it sees the result (look_at_picture) before it goes on.
 */
export type PictureOp = {
  op: string
  x?: number
  y?: number
  width?: number
  height?: number
  unit?: 'percent' | 'px'
  fit?: 'cover' | 'contain' | 'inside' | 'fill'
  color?: string
  tolerance?: number
  feather?: number
  contiguous?: boolean
  degrees?: number
  axis?: 'horizontal' | 'vertical'
  shape?: 'circle' | 'rounded'
  radius?: number
  sigma?: number
  brightness?: number
  saturation?: number
  hue?: number
  contrast?: number
  top?: number
  right?: number
  bottom?: number
  left?: number
  background?: string
  threshold?: number
}

export const OPERATIONS = ['crop', 'resize', 'trim', 'rotate', 'flip', 'make_transparent', 'mask', 'grayscale', 'tint', 'adjust', 'blur', 'sharpen', 'pad', 'background'] as const

export const MAX_SIDE = 4096
const VIEW_SIDE = 1024

type Raw = { data: Buffer; width: number; height: number }

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

function colorOf(value: string | undefined, fallback: string | { r: number; g: number; b: number; alpha: number }): string | { r: number; g: number; b: number; alpha: number } {
  if (!value) return fallback
  if (/^transparent$/i.test(value.trim())) return TRANSPARENT
  return value.trim()
}

function need(op: PictureOp, ...names: (keyof PictureOp)[]): void {
  const missing = names.filter((name) => op[name] === undefined)
  if (missing.length > 0) throw new Error(`${op.op} needs ${missing.join(', ')}.`)
}

function inRange(name: string, value: number | undefined, low: number, high: number): number {
  if (value === undefined || !Number.isFinite(value) || value < low || value > high) throw new Error(`${name} must be between ${low} and ${high}.`)
  return value
}

/** A picture as raw pixels with an alpha channel. A vector picture is drawn at a size that stays sharp. */
export async function readRaster(bytes: Uint8Array, kind: PictureKind): Promise<Raw> {
  const base =
    kind === 'svg'
      ? sharp(Buffer.from(bytes), { density: 144 }).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: false })
      : sharp(Buffer.from(bytes), { failOn: 'none', limitInputPixels: 120_000_000 }).rotate()
  return done(base)
}

const pipe = (raw: Raw) => sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })

async function done(image: Sharp): Promise<Raw> {
  const { data, info } = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/** The colour difference of two pixels, 0 to 100. */
const distance = (r: number, g: number, b: number, key: [number, number, number]) => (Math.sqrt((r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2) / 441.6729559) * 100

function parseKey(color: string | undefined, raw: Raw): [number, number, number] {
  if (!color || color === 'auto') return [raw.data[0], raw.data[1], raw.data[2]]
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!hex) throw new Error(`make_transparent needs color as a hex colour such as #ffffff, or auto. Got ${color}.`)
  const text = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1]
  return [0, 2, 4].map((at) => Number.parseInt(text.slice(at, at + 2), 16)) as [number, number, number]
}

/**
 * Make a colour see-through. By default only the part joined to the edge goes, so a white background is removed and the
 * white inside a letter stays; contiguous false removes the colour everywhere. The edge is softened over `feather`.
 */
function keyOut(raw: Raw, op: PictureOp): Raw {
  const key = parseKey(op.color, raw)
  const tolerance = inRange('tolerance', op.tolerance ?? 12, 0, 60)
  const feather = inRange('feather', op.feather ?? 8, 0, 30)
  const { width, height } = raw
  const data = Buffer.from(raw.data)
  const at = (pixel: number) => pixel * 4
  const gone = new Uint8Array(width * height)
  const matches = (pixel: number) => data[at(pixel) + 3] === 0 || distance(data[at(pixel)], data[at(pixel) + 1], data[at(pixel) + 2], key) <= tolerance
  if (op.contiguous === false) {
    for (let pixel = 0; pixel < width * height; pixel += 1) if (matches(pixel)) gone[pixel] = 1
  } else {
    const queue = new Int32Array(width * height)
    let head = 0
    let tail = 0
    const push = (pixel: number) => {
      if (!gone[pixel] && matches(pixel)) {
        gone[pixel] = 1
        queue[tail] = pixel
        tail += 1
      }
    }
    for (let x = 0; x < width; x += 1) {
      push(x)
      push((height - 1) * width + x)
    }
    for (let y = 0; y < height; y += 1) {
      push(y * width)
      push(y * width + width - 1)
    }
    while (head < tail) {
      const pixel = queue[head]
      head += 1
      const x = pixel % width
      if (x > 0) push(pixel - 1)
      if (x < width - 1) push(pixel + 1)
      if (pixel >= width) push(pixel - width)
      if (pixel < width * (height - 1)) push(pixel + width)
    }
  }
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (gone[pixel]) {
      data[at(pixel) + 3] = 0
    } else if (feather > 0) {
      const x = pixel % width
      const touches = (x > 0 && gone[pixel - 1]) || (x < width - 1 && gone[pixel + 1]) || (pixel >= width && gone[pixel - width]) || (pixel < width * (height - 1) && gone[pixel + width])
      if (touches) {
        const amount = (distance(data[at(pixel)], data[at(pixel) + 1], data[at(pixel) + 2], key) - tolerance) / feather
        if (amount < 1) data[at(pixel) + 3] = Math.round(data[at(pixel) + 3] * Math.max(0, amount))
      }
    }
  }
  return { data, width, height }
}

async function mask(raw: Raw, op: PictureOp): Promise<Raw> {
  let source = raw
  const shape = op.shape ?? 'circle'
  if (shape === 'circle') {
    const side = Math.min(raw.width, raw.height)
    source = await done(pipe(raw).extract({ left: Math.floor((raw.width - side) / 2), top: Math.floor((raw.height - side) / 2), width: side, height: side }))
  }
  const { width, height } = source
  const radius = shape === 'circle' ? Math.min(width, height) / 2 : (Math.min(width, height) * inRange('radius', op.radius ?? 12, 0, 50)) / 100
  const svg =
    shape === 'circle'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${radius}"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}"/></svg>`
  return done(pipe(source).composite([{ input: Buffer.from(svg), blend: 'dest-in' }]))
}

async function apply(raw: Raw, op: PictureOp): Promise<Raw> {
  switch (op.op) {
    case 'crop': {
      need(op, 'x', 'y', 'width', 'height')
      const percent = (op.unit ?? 'percent') === 'percent'
      const left = Math.round(percent ? (inRange('x', op.x, 0, 100) * raw.width) / 100 : inRange('x', op.x, 0, raw.width))
      const top = Math.round(percent ? (inRange('y', op.y, 0, 100) * raw.height) / 100 : inRange('y', op.y, 0, raw.height))
      const width = Math.round(percent ? (inRange('width', op.width, 0.1, 100) * raw.width) / 100 : inRange('width', op.width, 1, raw.width))
      const height = Math.round(percent ? (inRange('height', op.height, 0.1, 100) * raw.height) / 100 : inRange('height', op.height, 1, raw.height))
      const box = { left: Math.min(left, raw.width - 1), top: Math.min(top, raw.height - 1), width: Math.max(1, Math.min(width, raw.width - left)), height: Math.max(1, Math.min(height, raw.height - top)) }
      return done(pipe(raw).extract(box))
    }
    case 'resize': {
      if (op.width === undefined && op.height === undefined) throw new Error('resize needs width or height, in pixels.')
      const width = op.width === undefined ? undefined : Math.round(inRange('width', op.width, 1, MAX_SIDE))
      const height = op.height === undefined ? undefined : Math.round(inRange('height', op.height, 1, MAX_SIDE))
      return done(pipe(raw).resize({ width, height, fit: op.fit ?? 'cover', background: colorOf(op.background, TRANSPARENT) }))
    }
    case 'trim':
      return done(pipe(raw).trim({ threshold: Math.round(inRange('threshold', op.threshold ?? 10, 0, 100) * 2.55) }))
    case 'rotate':
      need(op, 'degrees')
      return done(pipe(raw).rotate(inRange('degrees', op.degrees, -360, 360), { background: colorOf(op.background, TRANSPARENT) }))
    case 'flip':
      if (op.axis !== 'horizontal' && op.axis !== 'vertical') throw new Error('flip needs axis: horizontal or vertical.')
      return done(op.axis === 'horizontal' ? pipe(raw).flop() : pipe(raw).flip())
    case 'make_transparent':
      return keyOut(raw, op)
    case 'mask':
      return mask(raw, op)
    case 'grayscale':
      // modulate keeps three colour channels, which the next operation expects; grayscale() would leave one.
      return done(pipe(raw).modulate({ saturation: 0 }))
    case 'tint':
      if (!op.color) throw new Error('tint needs color.')
      return done(pipe(raw).tint(op.color))
    case 'adjust': {
      const contrast = op.contrast === undefined ? 1 : inRange('contrast', op.contrast, 0.2, 3)
      const change: { brightness?: number; saturation?: number; hue?: number } = {}
      if (op.brightness !== undefined) change.brightness = inRange('brightness', op.brightness, 0.1, 3)
      if (op.saturation !== undefined) change.saturation = inRange('saturation', op.saturation, 0, 3)
      if (op.hue !== undefined) change.hue = inRange('hue', op.hue, -360, 360)
      let image = Object.keys(change).length > 0 ? pipe(raw).modulate(change) : pipe(raw)
      if (contrast !== 1) image = image.linear(contrast, 128 * (1 - contrast))
      return done(image)
    }
    case 'blur':
      return done(pipe(raw).blur(inRange('sigma', op.sigma ?? 3, 0.3, 100)))
    case 'sharpen':
      return done(pipe(raw).sharpen())
    case 'pad': {
      const side = (value: number | undefined, name: string) => Math.round(value === undefined ? 0 : inRange(name, value, 0, MAX_SIDE))
      const extend = { top: side(op.top, 'top'), right: side(op.right, 'right'), bottom: side(op.bottom, 'bottom'), left: side(op.left, 'left') }
      if (Object.values(extend).every((value) => value === 0)) throw new Error('pad needs top, right, bottom or left, in pixels.')
      return done(pipe(raw).extend({ ...extend, background: colorOf(op.background, TRANSPARENT) }))
    }
    case 'background':
      if (!op.color) throw new Error('background needs color.')
      return done(pipe(raw).flatten({ background: op.color }))
    default:
      throw new Error(`Unknown operation ${op.op}. Use ${OPERATIONS.join(', ')}.`)
  }
}

export type EditResult = { bytes: Buffer; format: 'png' | 'jpeg' | 'webp'; width: number; height: number; transparent: boolean }

/** Carry out the operations in order and write the picture. A picture with see-through parts is a PNG; one without keeps a photograph's JPEG. */
export async function editRaster(bytes: Uint8Array, kind: PictureKind, ops: PictureOp[], format?: 'png' | 'jpeg' | 'webp'): Promise<EditResult> {
  let raw = await readRaster(bytes, kind)
  for (const [at, op] of ops.entries()) {
    try {
      raw = await apply(raw, op)
    } catch (error) {
      throw new Error(`Operation ${at + 1} (${op.op}): ${error instanceof Error ? error.message : 'failed'}`)
    }
  }
  if (Math.max(raw.width, raw.height) > MAX_SIDE) raw = await done(pipe(raw).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside' }))
  const png = await pipe(raw).png().toBuffer()
  const transparent = !(await sharp(png).stats()).isOpaque
  const chosen = format ?? (transparent ? 'png' : kind === 'jpeg' ? 'jpeg' : kind === 'webp' ? 'webp' : 'png')
  if (transparent && chosen === 'jpeg') throw new Error('The picture has see-through parts, which a JPEG cannot keep. Use png or webp, or add a background colour first.')
  const out = chosen === 'png' ? png : chosen === 'jpeg' ? await pipe(raw).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer() : await pipe(raw).webp({ quality: 90 }).toBuffer()
  return { bytes: out, format: chosen, width: raw.width, height: raw.height, transparent }
}

// What a picture looks like to the model, and the grid that lets it name a place without counting pixels.

export type Region = { x: number; y: number; width: number; height: number }

const checker = (width: number, height: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="c" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#ffffff"/><rect width="12" height="12" fill="#d9d9d9"/><rect x="12" y="12" width="12" height="12" fill="#d9d9d9"/></pattern></defs><rect width="${width}" height="${height}" fill="url(#c)"/></svg>`,
  )

const nice = (value: number) => (Math.abs(value - Math.round(value)) < 0.05 ? String(Math.round(value)) : value.toFixed(1))

function gridOverlay(width: number, height: number, region: Region): Buffer {
  const size = Math.max(11, Math.round(Math.min(width, height) / 48))
  const parts: string[] = []
  for (let step = 0; step <= 10; step += 1) {
    const x = (step * width) / 10
    const y = (step * height) / 10
    if (step > 0 && step < 10) {
      parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#ff00ff" stroke-opacity="0.6" stroke-width="1.5"/>`)
      parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#ff00ff" stroke-opacity="0.6" stroke-width="1.5"/>`)
    }
    const labelX = nice(region.x + (step * region.width) / 10)
    const labelY = nice(region.y + (step * region.height) / 10)
    const boxW = labelX.length * size * 0.62 + 6
    const textX = Math.min(Math.max(x, boxW / 2), width - boxW / 2)
    parts.push(`<rect x="${textX - boxW / 2}" y="0" width="${boxW}" height="${size + 4}" fill="#000" fill-opacity="0.7"/><text x="${textX}" y="${size + 0}" font-size="${size}" font-family="sans-serif" fill="#fff" text-anchor="middle">${labelX}</text>`)
    const boxH = size + 4
    const textY = Math.min(Math.max(y, boxH / 2 + 2), height - boxH / 2)
    const w = labelY.length * size * 0.62 + 6
    parts.push(`<rect x="0" y="${textY - boxH / 2}" width="${w}" height="${boxH}" fill="#000" fill-opacity="0.7"/><text x="${w / 2}" y="${textY + size / 2 - 2}" font-size="${size}" font-family="sans-serif" fill="#fff" text-anchor="middle">${labelY}</text>`)
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`)
}

export type Seen = { jpeg: Buffer; width: number; height: number; transparent: boolean; note: string }

/** A picture as the model sees it: at most 1024 px, a chequered ground where it is see-through, and a grid labelled in percent of the whole picture. */
export async function pictureForModel(bytes: Uint8Array, kind: PictureKind, options: { grid?: boolean; region?: Region } = {}): Promise<Seen> {
  let raw = await readRaster(bytes, kind)
  const full = { width: raw.width, height: raw.height }
  const region = options.region ?? { x: 0, y: 0, width: 100, height: 100 }
  if (options.region) {
    const left = Math.round((inRange('region x', region.x, 0, 99.9) * raw.width) / 100)
    const top = Math.round((inRange('region y', region.y, 0, 99.9) * raw.height) / 100)
    raw = await done(pipe(raw).extract({ left, top, width: Math.max(1, Math.min(raw.width - left, Math.round((inRange('region width', region.width, 0.1, 100) * raw.width) / 100))), height: Math.max(1, Math.min(raw.height - top, Math.round((inRange('region height', region.height, 0.1, 100) * raw.height) / 100))) }))
  }
  const longest = Math.max(raw.width, raw.height)
  const scale = longest < 256 ? 384 / longest : Math.min(1, VIEW_SIDE / longest)
  const width = Math.max(1, Math.round(raw.width * scale))
  const height = Math.max(1, Math.round(raw.height * scale))
  const shown = await done(pipe(raw).resize({ width, height, kernel: scale > 1 ? 'nearest' : 'lanczos3' }))
  const png = await pipe(shown).png().toBuffer()
  const transparent = !(await sharp(png).stats()).isOpaque
  const layers: OverlayOptions[] = []
  if (options.grid) layers.push({ input: gridOverlay(width, height, region) })
  const base = transparent ? sharp(checker(width, height)).composite([{ input: png }, ...layers]) : sharp(png).flatten({ background: '#ffffff' }).composite(layers)
  const jpeg = await base.jpeg({ quality: 80 }).toBuffer()
  const cellW = Math.round((full.width * region.width) / 1000)
  const cellH = Math.round((full.height * region.height) / 1000)
  const note = options.grid ? `Grid lines every 10 % of ${options.region ? 'the part shown' : 'the picture'}, about ${cellW} × ${cellH} px each. The numbers on the edges are percent of the whole picture: x from the left, y from the top.` : ''
  return { jpeg, width: full.width, height: full.height, transparent, note }
}

// Where in an SVG's own units something is drawn. It is drawn once, large, and the pixels it covers are measured.

/** The box an SVG draws inside, in its own units, or null when it draws nothing. */
export async function visibleBounds(svg: string): Promise<SvgBox | null> {
  const box = svgBox(svg)
  const side = 2000
  const width = box.width >= box.height ? side : Math.max(1, Math.round((side * box.width) / box.height))
  const height = box.width >= box.height ? Math.max(1, Math.round((side * box.height) / box.width)) : side
  const sized = editSvg(svg, [
    { op: 'set', attr: 'width', value: String(width) },
    { op: 'set', attr: 'height', value: String(height) },
  ]).svg
  const { data, info } = await sharp(Buffer.from(sized), { density: 72 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width
  let right = -1
  let top = info.height
  let bottom = -1
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 12) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  if (right < 0) return null
  const unitX = box.width / info.width
  const unitY = box.height / info.height
  return { x: box.x + left * unitX, y: box.y + top * unitY, width: (right - left + 1) * unitX, height: (bottom - top + 1) * unitY }
}
