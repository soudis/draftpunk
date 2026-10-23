import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { initSite, readTokens } from '@schlor/generator'
import { closeBrowser } from './browser'
import { graphicBase, graphicDocument, renderGraphic } from './graphic'
import { pictureTools } from './picture-tools'
import { ScreenshotStore } from './screenshots'

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file))
const skip = CHROME ? false : 'no Chrome on this machine'

const pixel = async (bytes: Uint8Array, x: number, y: number) => {
  const { data, info } = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * 4
  return [data[at], data[at + 1], data[at + 2], data[at + 3]]
}
const hexOf = (color: string) => [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16))

test('the page has the site tokens as variables, and a whole document gets them too', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-graphic-base-'))
  initSite(root)
  const tokens = readTokens(root)
  assert.ok(graphicBase(root).includes(`--color-primary:${tokens.colors.primary}`))
  assert.match(graphicDocument(root, { html: '<p>x</p>', width: 100, height: 50 }), /^<!doctype html><html><head><meta charset="utf-8"><style>[\s\S]*width:100px;height:50px[\s\S]*<\/style><\/head><body><p>x<\/p><\/body><\/html>$/)
  assert.match(graphicDocument(root, { html: '<html><head><title>t</title></head><body>x</body></html>', width: 10, height: 10 }), /<head><meta charset="utf-8"><style>[\s\S]*<\/style><title>t<\/title>/)
  assert.match(graphicDocument(root, { html: '<html><body>x</body></html>', width: 10, height: 10 }), /<html><head><meta charset="utf-8"><style>/)
  assert.doesNotMatch(graphicDocument(root, { html: 'x', width: 20, height: 20, transparent: true }), /background:#fff/)
})

test('a graphic is drawn with the site colours and pictures, and loads nothing else', { skip }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-graphic-'))
    initSite(root)
    fs.mkdirSync(path.join(root, 'media'), { recursive: true })
    fs.writeFileSync(path.join(root, 'media', 'rot.png'), await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ff0000' } }).png().toBuffer())
    const primary = hexOf(readTokens(root).colors.primary)

    const card = await renderGraphic(root, { html: '<div style="position:absolute;inset:0;background:var(--color-primary)"></div><img src="/media/rot.png" style="position:absolute;left:10px;top:10px;width:50px;height:50px">', width: 300, height: 200 })
    assert.deepEqual([card.width, card.height, card.format], [300, 200, 'png'])
    assert.deepEqual((await pixel(card.bytes, 200, 150)).slice(0, 3), primary, 'the colour of a token')
    assert.deepEqual((await pixel(card.bytes, 30, 30)).slice(0, 3), [255, 0, 0], 'a picture of the site')

    const sharper = await renderGraphic(root, { html: '<div style="width:100px;height:100px;background:#00f"></div>', width: 300, height: 200, scale: 2, format: 'webp' })
    assert.deepEqual([sharper.width, sharper.height, sharper.format], [600, 400, 'webp'])
    assert.equal((await sharp(sharper.bytes).metadata()).width, 600)

    // A script does not run, and a picture, a style or a font from another address is not loaded.
    const guarded = await renderGraphic(root, {
      html: '<script>document.body.style.background="#f00"</script><div style="position:absolute;inset:0;background:url(https://example.org/a.png) #0f0"></div><img src="https://example.org/b.png" style="position:absolute;width:80px;height:80px" alt="">',
      width: 120,
      height: 100,
    })
    assert.deepEqual((await pixel(guarded.bytes, 100, 90)).slice(0, 3), [0, 255, 0], 'only the plain colour shows; the script did not turn the page red')
    const outside = await renderGraphic(root, { html: '<img src="/media/../design/brief.md" alt=""><img src="/design/brief.md" alt="">', width: 40, height: 40 })
    assert.deepEqual((await pixel(outside.bytes, 20, 20)).slice(0, 3), [255, 255, 255])

    const clear = await renderGraphic(root, { html: '<div style="position:absolute;left:50px;top:50px;width:20px;height:20px;background:#00f"></div>', width: 100, height: 100, transparent: true })
    assert.equal((await pixel(clear.bytes, 5, 5))[3], 0)
    assert.deepEqual(await pixel(clear.bytes, 60, 60), [0, 0, 255, 255])

    await assert.rejects(() => renderGraphic(root, { html: 'x', width: 100, height: 100, transparent: true, format: 'jpeg' }), /JPEG cannot keep see-through/)
    await assert.rejects(() => renderGraphic(root, { html: 'x', width: 3000, height: 100, scale: 2 }), /at most 4096 px/)
    await assert.rejects(() => renderGraphic(root, { html: 'x', width: 8, height: 100 }), /at least 16/)
    await assert.rejects(() => renderGraphic(root, { html: 'x'.repeat(100_001), width: 100, height: 100 }), /Keep it under 100 KB/)
    await assert.rejects(() => renderGraphic(root, { html: 'x', width: 100, height: 100, scale: 3 }), /scale is 1 or 2/)
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})

test('the tools save a graphic and a trace as pictures, and show them', { skip }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-graphic-tools-'))
    initSite(root)
    const store = new ScreenshotStore()
    const tools = pictureTools(root, { vision: true, screenshots: store })
    assert.ok(tools.render_graphic && tools.trace_picture)
    const call = { toolCallId: 'graphic', messages: [] }
    const made = String(await tools.render_graphic.execute!({ html: '<div style="position:absolute;inset:0;background:#111;color:#fff;font:700 40px sans-serif;padding:20px">Fest im Hof</div>', width: 600, height: 315, name: 'teilen', description: 'Karte: Fest im Hof' }, call))
    assert.match(made, /^Saved \/media\/teilen\.png\. 600 × 315 px, no see-through parts\. \[screenshot:s\d+\]/)
    assert.equal(fs.existsSync(path.join(root, 'media', 'teilen.png')), true)
    assert.match(fs.readFileSync(path.join(root, 'media', 'pictures.yml'), 'utf8'), /description: "Karte: Fest im Hof"/)
    const traced = String(await tools.trace_picture.execute!({ file: 'teilen.png', mode: 'silhouette', invert: true, name: 'teilen-form' }, call))
    assert.match(traced, /^Saved \/media\/teilen-form\.svg, traced from \/media\/teilen\.png: \d+ paths in 1 layer/)
    assert.match(fs.readFileSync(path.join(root, 'media', 'pictures.yml'), 'utf8'), /file: teilen-form\.svg[\s\S]*madeFrom: teilen\.png/)
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})

test('without a browser there is no render_graphic, and the other tools remain', () => {
  const before = process.env.BROWSER_PATH
  const url = process.env.BROWSER_URL
  delete process.env.BROWSER_PATH
  delete process.env.BROWSER_URL
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-graphic-none-'))
    const tools = pictureTools(root)
    assert.equal(Object.keys(tools).includes('render_graphic'), false)
    assert.ok(tools.trace_picture && tools.edit_picture && tools.write_svg)
  } finally {
    if (before !== undefined) process.env.BROWSER_PATH = before
    if (url !== undefined) process.env.BROWSER_URL = url
  }
})
