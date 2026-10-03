import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseSuggestion } from './picture-vision'
import { detectPicture, discardPicture, listPictures, storePicture, updatePicture } from './pictures'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
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

test('a suggestion parses the JSON object from the reply', () => {
  assert.deepEqual(parseSuggestion('Here you go {"name":"Cafe Photo","description":"Das Café","tags":["Café"]}'), {
    name: 'cafe-photo',
    description: 'Das Café',
    tags: ['Café'],
  })
  assert.deepEqual(parseSuggestion('no json'), { name: '', description: '', tags: [] })
})
