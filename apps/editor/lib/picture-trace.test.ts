import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { potraceAvailable, tracePicture } from './picture-trace'

const available = await potraceAvailable()
const skip = available ? false : 'potrace is not installed on this machine'

const shapes = async (parts: { svg: string }[], width: number, height: number, background = '#ffffff') => {
  const base = sharp({ create: { width, height, channels: 3, background } })
  return base.composite(await Promise.all(parts.map(async (part) => ({ input: await sharp(Buffer.from(part.svg)).png().toBuffer() })))).png().toBuffer()
}
const rect = (x: number, y: number, w: number, h: number, fill: string, size: [number, number]) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/></svg>` })

/** The pixel of the traced picture, drawn at 200 px wide. */
async function look(svg: string, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(Buffer.from(svg)).resize({ width: 200 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * 4
  return [data[at], data[at + 1], data[at + 2], data[at + 3]]
}

test('a dark shape on a light ground becomes one filled shape, and the ground stays empty', { skip }, async () => {
  const circle = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><circle cx="150" cy="150" r="100" fill="#111111"/></svg>' }
  const traced = await tracePicture(await shapes([circle], 300, 300), 'png')
  assert.equal(traced.layers, 1)
  assert.ok(traced.paths >= 1 && traced.bytes < 20_000, `${traced.paths} paths, ${traced.bytes} bytes`)
  assert.match(traced.svg, /<svg[^>]*viewBox="0 0 8\d\d 8\d\d"/)
  assert.ok(!traced.svg.includes('metadata'))
  const middle = await look(traced.svg, 100, 100)
  assert.ok(middle[3] === 255 && middle[0] < 40, `the middle is dark: ${middle}`)
  assert.equal((await look(traced.svg, 5, 5))[3], 0, 'the corner is empty')
  assert.match(traced.colors[0], /^#[01][0-9a-f][01][0-9a-f][01][0-9a-f]$/, 'the colour is the ink')
  const coloured = await tracePicture(await shapes([circle], 300, 300), 'png', { color: '#1f5f54' })
  assert.equal(coloured.colors[0], '#1f5f54')
  assert.ok(coloured.svg.includes('#1f5f54'))
})

test('a light shape is traced with invert, and nothing to trace is said plainly', { skip }, async () => {
  const white = await shapes([rect(100, 100, 100, 100, '#ffffff', [300, 300])], 300, 300, '#222222')
  const inverted = await tracePicture(white, 'png', { invert: true })
  assert.ok((await look(inverted.svg, 100, 100))[3] === 255)
  await assert.rejects(() => tracePicture(white, 'png', { threshold: 5 }), /Nothing was found to trace/)
  await assert.rejects(() => tracePicture(white, 'png', { smooth: 5 }), /smooth must be between/)
  await assert.rejects(() => tracePicture(white, 'png', { color: 'red' }), /color must be #rrggbb/)
})

test('a picture with see-through parts is traced by its shape, in its own colour', { skip }, async () => {
  const logo = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 160, height: 160, channels: 3, background: '#e03030' } }).png().toBuffer(), left: 70, top: 70 }])
    .png()
    .toBuffer()
  const traced = await tracePicture(logo, 'png')
  assert.match(traced.colors[0], /^#e[0-9a-f]3[0-9a-f]3[0-9a-f]$/)
  const middle = await look(traced.svg, 100, 100)
  assert.ok(middle[0] > 200 && middle[1] < 80, `${middle}`)
  assert.equal((await look(traced.svg, 5, 5))[3], 0)
})

test('colours are traced one layer over the other, the ground is dropped, and a one-colour picture is refused', { skip }, async () => {
  const flag = await shapes(
    [rect(20, 20, 80, 160, '#d02020', [300, 200]), rect(110, 20, 80, 160, '#2040d0', [300, 200]), rect(200, 20, 80, 160, '#20a040', [300, 200])],
    300,
    200,
  )
  const traced = await tracePicture(flag, 'png', { mode: 'colors', colors: 4 })
  assert.ok(traced.layers >= 3, `${traced.layers} layers`)
  assert.equal((await look(traced.svg, 2, 2))[3], 0, 'the white ground is not a shape')
  const [red, blue, green] = [await look(traced.svg, 40, 66), await look(traced.svg, 100, 66), await look(traced.svg, 160, 66)]
  assert.ok(red[0] > 150 && red[2] < 90, `red ${red}`)
  assert.ok(blue[2] > 150 && blue[0] < 90, `blue ${blue}`)
  assert.ok(green[1] > 110 && green[0] < 90, `green ${green}`)
  const kept = await tracePicture(flag, 'png', { mode: 'colors', colors: 4, keepBackground: true })
  assert.equal((await look(kept.svg, 2, 2))[3], 255, 'with the ground kept it is a shape too')
  const plain = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer()
  await assert.rejects(() => tracePicture(plain, 'png', { mode: 'colors' }), /only one colour/)
})

test('a vector picture is drawn first, and a speck is dropped with despeckle', { skip }, async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="20" y="20" width="60" height="60" fill="#000"/><rect x="2" y="2" width="1" height="1" fill="#000"/></svg>')
  const rough = await tracePicture(svg, 'svg', { despeckle: 0 })
  const clean = await tracePicture(svg, 'svg', { despeckle: 40 })
  assert.ok(rough.paths >= clean.paths)
  assert.ok(clean.bytes <= rough.bytes)
})

test('a see-through picture with details inside its outline says that a silhouette loses them', { skip }, async () => {
  const outline = async (inner: boolean) => {
    const layers = [{ input: await sharp({ create: { width: 160, height: 160, channels: 3, background: '#e03030' } }).png().toBuffer(), left: 70, top: 70 }]
    if (inner) layers.push({ input: await sharp({ create: { width: 60, height: 60, channels: 3, background: '#ffffff' } }).png().toBuffer(), left: 120, top: 120 })
    return sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer()
  }
  assert.match((await tracePicture(await outline(true), 'png')).hint ?? '', /Trace again with mode colors/)
  assert.equal((await tracePicture(await outline(false), 'png')).hint, undefined)
  const detailed = await tracePicture(await outline(true), 'png', { mode: 'colors', colors: 2 })
  assert.equal(detailed.layers, 2)
  assert.equal(detailed.hint, undefined)
})
