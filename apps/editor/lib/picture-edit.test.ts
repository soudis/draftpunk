import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { editRaster, pictureForModel, visibleBounds } from './picture-edit'

const RED = { r: 255, g: 0, b: 0 }

/** 400 × 200, white, with a red square of 100 × 100 at (200, 50) and a white hole of 40 × 40 in it. */
async function sample(format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const base = sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } })
  const square = await sharp({ create: { width: 100, height: 100, channels: 3, background: RED } }).png().toBuffer()
  const hole = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const image = base.composite([{ input: square, left: 200, top: 50 }, { input: hole, left: 230, top: 80 }])
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 95 }).toBuffer()
}

const pixel = async (bytes: Uint8Array, x: number, y: number) => {
  const { data, info } = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * 4
  return [data[at], data[at + 1], data[at + 2], data[at + 3]]
}

test('a crop is in percent of the picture, a resize in pixels, and a trim takes the plain border', async () => {
  const input = await sample()
  const cropped = await editRaster(input, 'png', [{ op: 'crop', x: 50, y: 25, width: 25, height: 50 }])
  assert.deepEqual([cropped.width, cropped.height], [100, 100])
  assert.deepEqual((await pixel(cropped.bytes, 5, 5)).slice(0, 3), [255, 0, 0])
  const small = await editRaster(input, 'png', [{ op: 'resize', width: 100, fit: 'inside' }])
  assert.deepEqual([small.width, small.height], [100, 50])
  const trimmed = await editRaster(input, 'png', [{ op: 'trim' }])
  assert.deepEqual([trimmed.width, trimmed.height], [100, 100])
  const pixels = await editRaster(input, 'png', [{ op: 'crop', x: 200, y: 50, width: 100, height: 100, unit: 'px' }, { op: 'rotate', degrees: 90 }, { op: 'flip', axis: 'horizontal' }])
  assert.deepEqual([pixels.width, pixels.height], [100, 100])
})

test('a colour is made see-through where it joins the edge, not inside the picture', async () => {
  const out = await editRaster(await sample(), 'png', [{ op: 'make_transparent', color: '#ffffff', tolerance: 10, feather: 0 }])
  assert.equal(out.transparent, true)
  assert.equal(out.format, 'png')
  assert.equal((await pixel(out.bytes, 2, 2))[3], 0, 'the corner')
  assert.equal((await pixel(out.bytes, 250, 100))[3], 255, 'the white inside the red square stays')
  assert.deepEqual(await pixel(out.bytes, 210, 60), [255, 0, 0, 255])
  const everywhere = await editRaster(await sample(), 'png', [{ op: 'make_transparent', color: 'auto', contiguous: false, feather: 0 }])
  assert.equal((await pixel(everywhere.bytes, 250, 100))[3], 0, 'with contiguous false the inside goes too')
})

test('a mask, a pad and a background change the corners', async () => {
  const circle = await editRaster(await sample(), 'png', [{ op: 'mask', shape: 'circle' }])
  assert.deepEqual([circle.width, circle.height], [200, 200])
  assert.equal((await pixel(circle.bytes, 1, 1))[3], 0)
  assert.equal((await pixel(circle.bytes, 100, 100))[3], 255)
  const padded = await editRaster(await sample(), 'png', [{ op: 'pad', top: 10, bottom: 10, left: 20, right: 20 }])
  assert.deepEqual([padded.width, padded.height], [440, 220])
  assert.equal((await pixel(padded.bytes, 0, 0))[3], 0)
  const flat = await editRaster(padded.bytes, 'png', [{ op: 'background', color: '#00ff00' }])
  assert.equal(flat.transparent, false)
  assert.deepEqual((await pixel(flat.bytes, 0, 0)).slice(0, 3), [0, 255, 0])
  const rounded = await editRaster(await sample(), 'png', [{ op: 'mask', shape: 'rounded', radius: 30 }])
  assert.equal((await pixel(rounded.bytes, 0, 0))[3], 0)
})

test('colour operations change the colours and the format follows the picture', async () => {
  const gray = await editRaster(await sample(), 'png', [{ op: 'grayscale' }])
  const [r, g, b] = await pixel(gray.bytes, 210, 60)
  assert.ok(r === g && g === b)
  const bright = await editRaster(await sample(), 'png', [{ op: 'adjust', brightness: 1.3, contrast: 1.2 }, { op: 'blur', sigma: 1 }, { op: 'sharpen' }, { op: 'tint', color: '#335577' }])
  assert.equal(bright.format, 'png')
  const jpeg = await editRaster(await sample('jpeg'), 'jpeg', [{ op: 'crop', x: 0, y: 0, width: 50, height: 50 }])
  assert.equal(jpeg.format, 'jpeg')
  const webp = await editRaster(await sample('jpeg'), 'jpeg', [{ op: 'resize', width: 100 }], 'webp')
  assert.equal(webp.format, 'webp')
  await assert.rejects(() => editRaster(await_sample_jpeg, 'jpeg', [{ op: 'mask' }], 'jpeg'), /see-through parts/)
  const big = await editRaster(await sample(), 'png', [{ op: 'resize', width: 4000, height: 4000, fit: 'fill' }, { op: 'pad', top: 200, left: 200 }])
  assert.ok(Math.max(big.width, big.height) <= 4096)
})
const await_sample_jpeg = await sample('jpeg')

test('a bad operation says which one and what it needs', async () => {
  const input = await sample()
  await assert.rejects(() => editRaster(input, 'png', [{ op: 'trim' }, { op: 'crop', x: 10 }]), /Operation 2 \(crop\): crop needs y, width, height\./)
  await assert.rejects(() => editRaster(input, 'png', [{ op: 'crop', x: 10, y: 0, width: 500, height: 10 }]), /width must be between 0\.1 and 100/)
  await assert.rejects(() => editRaster(input, 'png', [{ op: 'sparkle' }]), /Unknown operation sparkle\. Use crop, resize/)
  await assert.rejects(() => editRaster(input, 'png', [{ op: 'make_transparent', color: 'white' }]), /hex colour/)
  await assert.rejects(() => editRaster(input, 'png', [{ op: 'flip' }]), /axis/)
})

test('a vector picture is drawn before it is edited', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="10" height="5" fill="#00f"/></svg>')
  const out = await editRaster(svg, 'svg', [{ op: 'resize', width: 100 }])
  assert.deepEqual([out.width, out.height, out.format], [100, 50, 'png'])
  assert.deepEqual((await pixel(out.bytes, 50, 25)).slice(0, 3), [0, 0, 255])
})

test('the model sees a small picture with a grid in percent, and a chequered ground where it is see-through', async () => {
  const seen = await pictureForModel(await sample(), 'png', { grid: true })
  const meta = await sharp(seen.jpeg).metadata()
  assert.deepEqual([meta.width, meta.height], [400, 200])
  assert.equal(seen.transparent, false)
  assert.match(seen.note, /Grid lines every 10 % of the picture, about 40 × 20 px each/)
  const zoomed = await pictureForModel(await sample(), 'png', { grid: true, region: { x: 50, y: 25, width: 25, height: 50 } })
  assert.match(zoomed.note, /of the part shown, about 10 × 10 px each/)
  const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#888' } }).png().toBuffer()
  const shrunk = await sharp((await pictureForModel(big, 'png')).jpeg).metadata()
  assert.deepEqual([shrunk.width, shrunk.height], [1024, 512])
  const clear = await editRaster(await sample(), 'png', [{ op: 'make_transparent', feather: 0 }])
  assert.equal((await pictureForModel(clear.bytes, 'png')).transparent, true)
  const tiny = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#335' } }).png().toBuffer()
  assert.equal((await sharp((await pictureForModel(tiny, 'png')).jpeg).metadata()).width, 384)
})

test('the box an SVG draws in is measured in its own units', async () => {
  const box = await visibleBounds('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><g transform="translate(10 5)"><rect x="10" y="5" width="30" height="20" fill="#000"/></g></svg>')
  assert.ok(box)
  for (const [actual, expected] of [[box.x, 20], [box.y, 10], [box.width, 30], [box.height, 20]]) assert.ok(Math.abs(actual - expected) < 0.2, `${actual} is not ${expected}`)
  assert.equal(await visibleBounds('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5" fill="none"/></svg>'), null)
})
