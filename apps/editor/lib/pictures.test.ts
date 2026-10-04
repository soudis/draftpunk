import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { parseSuggestion } from './picture-vision'
import { detectPicture, discardPicture, fitPicture, listPictures, storePicture, updatePicture } from './pictures'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const gif = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'))
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

test('a picture keeps a taken name and can be discarded without changing content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-pictures-'))
  fs.mkdirSync(path.join(root, 'content'), { recursive: true })
  fs.writeFileSync(path.join(root, 'content', 'page.md'), 'See /media/hof.png and /media/hof.png.jpeg\n')
  const first = storePicture(root, { bytes: png, filename: 'Hof.png', description: 'Der Hof', tags: ['Hof', 'hof'] })
  const second = storePicture(root, { bytes: png, filename: 'hof.png', description: 'Noch ein Hof', tags: ['garten'] })
  assert.equal(first.address, '/media/hof.png')
  assert.equal(first.usages, 1)
  assert.deepEqual(first.tags, ['Hof'])
  assert.equal(second.file, 'hof-2.png')
  assert.equal(second.usages, 0)
  const replaced = storePicture(root, { bytes: png, filename: 'hof.png', replace: true, description: 'Ersetzt', tags: [] })
  assert.equal(replaced.file, 'hof.png')
  assert.equal(replaced.description, 'Ersetzt')
  assert.throws(() => updatePicture(root, 'hof-2.png', { name: 'hof', description: '', tags: [] }), /already used/)
  discardPicture(root, 'hof-2.png')
  assert.equal(fs.readFileSync(path.join(root, 'content', 'page.md'), 'utf8').includes('/media/hof.png'), true)
  assert.equal(listPictures(root).some((picture) => picture.file === 'hof-2.png'), false)
  assert.equal(fs.existsSync(path.join(root, 'media', 'pictures.yml')), true)
})

test('a paste with no filename starts as picture, and html is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-pictures-'))
  const saved = storePicture(root, { bytes: png, filename: 'picture' })
  assert.equal(saved.file, 'picture.png')
  assert.equal(detectPicture(svg), 'svg')
  assert.equal(detectPicture(new TextEncoder().encode('<!doctype html><svg></svg>')), null)
  assert.throws(() => storePicture(root, { bytes: new TextEncoder().encode('<html></html>'), filename: 'page.svg' }), /not a JPEG/)
})

test('a picture used on a page gets a WebP twice that wide, and the same copy is reused', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-pictures-'))
  const wide = new Uint8Array(await sharp({ create: { width: 40, height: 10, channels: 3, background: { r: 20, g: 40, b: 80 } } }).png().toBuffer())
  storePicture(root, { bytes: wide, filename: 'hof.png', description: 'Der Hof', tags: ['Hof'] })
  const fitted = await fitPicture(root, '/media/hof.png', 4)
  assert.equal(fitted.wrote, true)
  assert.match(fitted.message, /Use \/media\/hof-8\.webp/)
  const copy = await sharp(fs.readFileSync(path.join(root, 'media', 'hof-8.webp'))).metadata()
  assert.equal(copy.format, 'webp')
  assert.equal(copy.width, 8)
  assert.equal(copy.height, 2)
  assert.equal(fs.existsSync(path.join(root, 'media', 'hof.png')), true)
  const again = await fitPicture(root, 'hof.png', 4)
  assert.equal(again.wrote, false)
  assert.match(again.message, /\/media\/hof-8\.webp/)
  assert.equal(fs.readdirSync(path.join(root, 'media')).filter((name) => name.endsWith('.webp')).length, 1)
  const catalog = fs.readFileSync(path.join(root, 'media', 'pictures.yml'), 'utf8')
  assert.match(catalog, /source: hof\.png/)
  assert.match(catalog, /fitWidth: 8/)
  updatePicture(root, 'hof.png', { name: 'court', description: 'Der Hof', tags: ['Hof'] })
  const renamed = await fitPicture(root, '/media/court.png', 4)
  assert.equal(renamed.wrote, false)
  assert.match(renamed.message, /\/media\/hof-8\.webp/)
  const smaller = await fitPicture(root, '/media/court.png', 2)
  assert.equal(smaller.wrote, true)
  assert.match(smaller.message, /\/media\/court-4\.webp/)
})

test('a picture that already fits, and a GIF or SVG, stay as stored', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-pictures-'))
  storePicture(root, { bytes: png, filename: 'dot.png' })
  storePicture(root, { bytes: gif, filename: 'dot.gif' })
  storePicture(root, { bytes: svg, filename: 'mark.svg' })
  const small = await fitPicture(root, '/media/dot.png', 10)
  assert.equal(small.wrote, false)
  assert.match(small.message, /Left \/media\/dot\.png unchanged/)
  const motion = await fitPicture(root, '/media/dot.gif', 10)
  assert.equal(motion.wrote, false)
  assert.match(motion.message, /GIF/)
  const drawing = await fitPicture(root, '/media/mark.svg', 10)
  assert.equal(drawing.wrote, false)
  assert.match(drawing.message, /SVG/)
  assert.equal(fs.readdirSync(path.join(root, 'media')).some((name) => name.endsWith('.webp')), false)
  await assert.rejects(() => fitPicture(root, '/media/dot.png', 5000), /width the page gives/)
})

test('a suggestion parses the JSON object from the reply', () => {
  assert.deepEqual(parseSuggestion('Here you go {"name":"Cafe Photo","description":"Das Café","tags":["Café"]}'), {
    name: 'cafe-photo',
    description: 'Das Café',
    tags: ['Café'],
  })
  assert.deepEqual(parseSuggestion('no json'), { name: '', description: '', tags: [] })
})
