import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { fitSvg, sanitizeSvg, svgBox } from '@schlor/generator'
import { readRaster } from './picture-edit'
import type { PictureKind } from './pictures'

const run = promisify(execFile)

/**
 * A picture as flat shapes. potrace turns a black and white bitmap into curves; this file makes the bitmap (from the picture's
 * darkness, its see-through parts, or one colour of it at a time) and puts the colours back. It is for logos, icons, signatures
 * and drawings; a photograph traces into a mess.
 */
export type TraceOptions = {
  mode?: 'silhouette' | 'colors'
  /** silhouette: how dark counts as ink, percent. Default 50. */
  threshold?: number
  /** silhouette: the colour of the shape, #rrggbb, or auto for the average colour of the traced part. */
  color?: string
  /** colors: how many colours, 2 to 6. Default 4. */
  colors?: number
  /** Specks of up to this many pixels are dropped. Default 4. */
  despeckle?: number
  /** 0 keeps corners sharp, 1.3 rounds them. Default 1. */
  smooth?: number
  /** Trace the light part instead of the dark part. */
  invert?: boolean
  /** colors: keep the colour of the background as a shape too. */
  keepBackground?: boolean
}

export type Traced = { svg: string; layers: number; paths: number; bytes: number; colors: string[]; hint?: string }

let found: Promise<boolean> | undefined

/** Whether potrace is installed. The Docker image has it. */
export function potraceAvailable(): Promise<boolean> {
  found ??= run('potrace', ['--version']).then(() => true, () => false)
  return found
}

const MAX_SIDE = 1600
const MIN_SIDE = 800

type Bitmap = { data: Buffer; width: number; height: number }

async function bitmapOf(bytes: Uint8Array, kind: PictureKind): Promise<Bitmap> {
  const raw = await readRaster(bytes, kind)
  const longest = Math.max(raw.width, raw.height)
  const scale = longest > MAX_SIDE ? MAX_SIDE / longest : longest < MIN_SIDE ? MIN_SIDE / longest : 1
  if (scale === 1) return raw
  const { data, info } = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .resize({ width: Math.max(1, Math.round(raw.width * scale)), height: Math.max(1, Math.round(raw.height * scale)), kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/** One bit a pixel, 1 where the shape is, rows padded to whole bytes: the P4 bitmap potrace reads. */
function pbm(mask: Uint8Array, width: number, height: number): Buffer {
  const row = Math.ceil(width / 8)
  const body = Buffer.alloc(row * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) if (mask[y * width + x]) body[y * row + (x >> 3)] |= 0x80 >> (x & 7)
  }
  return Buffer.concat([Buffer.from(`P4\n${width} ${height}\n`), body])
}

async function potrace(mask: Uint8Array, width: number, height: number, folder: string, name: string, options: { color: string; despeckle: number; smooth: number }): Promise<string> {
  const input = path.join(folder, `${name}.pbm`)
  const output = path.join(folder, `${name}.svg`)
  fs.writeFileSync(input, pbm(mask, width, height))
  await run('potrace', ['--svg', '--output', output, '--turdsize', String(options.despeckle), '--alphamax', String(options.smooth), '--opttolerance', '0.4', '--color', options.color, input], { timeout: 60_000 })
  return fs.readFileSync(output, 'utf8')
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`

function number(name: string, value: number | undefined, fallback: number, low: number, high: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < low || value > high) throw new Error(`${name} must be between ${low} and ${high}.`)
  return value
}

function hasSeeThrough(bitmap: Bitmap): boolean {
  let clear = 0
  for (let at = 3; at < bitmap.data.length; at += 4) if (bitmap.data[at] < 200) clear += 1
  return clear / (bitmap.width * bitmap.height) > 0.005
}

/** The colours of a picture, found by grouping its pixels: a few starting points far from each other, then each point moves to the middle of its group. */
function groupColors(bitmap: Bitmap, count: number): { centers: [number, number, number][]; labels: Int8Array } {
  const pixels = bitmap.width * bitmap.height
  const step = Math.max(1, Math.floor(pixels / 30_000))
  const sample: [number, number, number][] = []
  for (let pixel = 0; pixel < pixels; pixel += step) {
    const at = pixel * 4
    if (bitmap.data[at + 3] >= 128) sample.push([bitmap.data[at], bitmap.data[at + 1], bitmap.data[at + 2]])
  }
  if (sample.length === 0) throw new Error('The picture has nothing to trace: it is entirely see-through.')
  const distance = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  const centers: [number, number, number][] = [sample[0]]
  while (centers.length < count) {
    let best = sample[0]
    let far = -1
    for (const point of sample) {
      const near = Math.min(...centers.map((center) => distance(point, center)))
      if (near > far) {
        far = near
        best = point
      }
    }
    if (far < 30) break
    centers.push(best)
  }
  for (let round = 0; round < 8; round += 1) {
    const sums = centers.map(() => [0, 0, 0, 0])
    for (const point of sample) {
      let nearest = 0
      let low = Infinity
      for (const [at, center] of centers.entries()) {
        const d = distance(point, center)
        if (d < low) {
          low = d
          nearest = at
        }
      }
      sums[nearest][0] += point[0]
      sums[nearest][1] += point[1]
      sums[nearest][2] += point[2]
      sums[nearest][3] += 1
    }
    for (const [at, sum] of sums.entries()) if (sum[3] > 0) centers[at] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]]
  }
  const labels = new Int8Array(pixels).fill(-1)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const at = pixel * 4
    if (bitmap.data[at + 3] < 128) continue
    let nearest = 0
    let low = Infinity
    for (let index = 0; index < centers.length; index += 1) {
      const center = centers[index]
      const d = (bitmap.data[at] - center[0]) ** 2 + (bitmap.data[at + 1] - center[1]) ** 2 + (bitmap.data[at + 2] - center[2]) ** 2
      if (d < low) {
        low = d
        nearest = index
      }
    }
    labels[pixel] = nearest
  }
  return { centers, labels }
}

export async function tracePicture(bytes: Uint8Array, kind: PictureKind, options: TraceOptions = {}): Promise<Traced> {
  if (!(await potraceAvailable())) throw new Error('potrace is not installed here. The Docker image has it; on another machine install the potrace package.')
  const mode = options.mode ?? 'silhouette'
  const settings = { despeckle: Math.round(number('despeckle', options.despeckle, 4, 0, 200)), smooth: number('smooth', options.smooth, 1, 0, 1.34) }
  const bitmap = await bitmapOf(bytes, kind)
  const { width, height } = bitmap
  const pixels = width * height
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-trace-'))
  try {
    const layers: { color: string; svg: string }[] = []
    let hint: string | undefined
    if (mode === 'silhouette') {
      const threshold = (number('threshold', options.threshold, 50, 1, 99) * 255) / 100
      const seeThrough = hasSeeThrough(bitmap)
      const mask = new Uint8Array(pixels)
      let red = 0
      let green = 0
      let blue = 0
      let count = 0
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        const at = pixel * 4
        const solid = bitmap.data[at + 3] >= 128
        const dark = bitmap.data[at] * 0.299 + bitmap.data[at + 1] * 0.587 + bitmap.data[at + 2] * 0.114 < threshold
        const inside = seeThrough ? solid : solid && dark
        const chosen = options.invert ? (seeThrough ? !solid : solid && !dark) : inside
        if (chosen) {
          mask[pixel] = 1
          if (solid) {
            red += bitmap.data[at]
            green += bitmap.data[at + 1]
            blue += bitmap.data[at + 2]
            count += 1
          }
        }
      }
      if (!mask.includes(1)) throw new Error('Nothing was found to trace at that threshold. Raise threshold to take more of the picture, or use invert for a light shape on a dark ground.')
      const wanted = options.color && options.color !== 'auto' ? options.color : null
      if (wanted && !/^#[0-9a-f]{6}$/i.test(wanted)) throw new Error(`color must be #rrggbb or auto. Got ${wanted}.`)
      const color = wanted ?? (count > 0 ? hex(red / count, green / count, blue / count) : '#000000')
      if (seeThrough && !options.invert && count > 0) {
        const mean = [red / count, green / count, blue / count]
        let apart = 0
        for (let pixel = 0; pixel < pixels; pixel += 1) {
          const at = pixel * 4
          if (mask[pixel] && Math.sqrt((bitmap.data[at] - mean[0]) ** 2 + (bitmap.data[at + 1] - mean[1]) ** 2 + (bitmap.data[at + 2] - mean[2]) ** 2) > 90) apart += 1
        }
        if (apart / count > 0.03) hint = 'The picture has parts of other colours inside its outline (windows, lettering, details). A silhouette shows only the outline and fills them. Trace again with mode colors to keep them.'
      }
      layers.push({ color, svg: await potrace(mask, width, height, folder, 'shape', { color, ...settings }) })
    } else {
      const count = Math.round(number('colors', options.colors, 4, 2, 6))
      const { centers, labels } = groupColors(bitmap, count)
      const area = centers.map(() => 0)
      for (const label of labels) if (label >= 0) area[label] += 1
      let background = -1
      if (!options.keepBackground && !hasSeeThrough(bitmap)) {
        const edge = centers.map(() => 0)
        for (let x = 0; x < width; x += 1) {
          edge[labels[x]] += 1
          edge[labels[(height - 1) * width + x]] += 1
        }
        for (let y = 0; y < height; y += 1) {
          edge[labels[y * width]] += 1
          edge[labels[y * width + width - 1]] += 1
        }
        background = edge.indexOf(Math.max(...edge))
      }
      // Largest first, each layer drawn over all the smaller ones' ground, so no gaps open between neighbours.
      const order = centers.map((_, index) => index).filter((index) => index !== background && area[index] > 0).sort((a, b) => area[b] - area[a])
      if (order.length === 0) throw new Error('The picture has only one colour. Use mode silhouette.')
      for (const [position, index] of order.entries()) {
        const rest = new Set(order.slice(position))
        const mask = new Uint8Array(pixels)
        for (let pixel = 0; pixel < pixels; pixel += 1) if (labels[pixel] >= 0 && rest.has(labels[pixel])) mask[pixel] = 1
        const [r, g, b] = centers[index]
        const color = hex(r, g, b)
        layers.push({ color, svg: await potrace(mask, width, height, folder, `layer${position}`, { color, ...settings }) })
      }
    }
    const first = layers[0].svg
    const head = /<svg\b[^>]*>/.exec(first)?.[0]
    if (!head) throw new Error('potrace gave nothing usable.')
    const groups = layers.map((layer) => /<g\b[\s\S]*<\/g>/.exec(layer.svg)?.[0] ?? '')
    const cleaned = sanitizeSvg(`${head}${groups.join('')}</svg>`).svg
    const sized = fitSvg(cleaned, svgBox(cleaned))
    return { svg: sized, layers: layers.length, paths: (sized.match(/<path\b/g) ?? []).length, bytes: Buffer.byteLength(sized), colors: layers.map((layer) => layer.color), ...(hint ? { hint } : {}) }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
