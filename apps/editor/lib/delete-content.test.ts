import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, writePageFile, writeYaml } from '@schlor/generator'
import { contentTools } from './tools'

const call = { toolCallId: 'delete', messages: [] }

test('content mode removes a page, an event, and a place, and discards a picture', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-delete-'))
  initSite(root)
  writePageFile(path.join(root, 'content', 'pages', 'alt', 'de.md'), {
    layout: 'article',
    title: 'Altes',
    date: '2020-01-01',
    body: 'Damals war hier /media/hof.png zu sehen.',
  })
  writePageFile(path.join(root, 'content', 'pages', 'alt', 'en.md'), {
    layout: 'article',
    title: 'Old',
    date: '2020-01-01',
    body: 'Old news.',
  })
  writeYaml(path.join(root, 'content', 'places', 'rappachgasse.yml'), {
    slug: 'rappachgasse',
    name: { de: 'Rappachgasse', en: 'Rappachgasse' },
    onPremises: true,
  })
  writeYaml(path.join(root, 'content', 'events', 'herbstfest.yml'), {
    slug: 'herbstfest',
    title: { de: 'Herbstfest', en: 'Autumn party' },
    body: { de: 'Ein Abend.', en: 'An evening.' },
    place: 'rappachgasse',
    categories: [],
    dates: [{ start: '2020-06-01T18:00:00+02:00', end: '2020-06-01T22:00:00+02:00' }],
  })
  fs.mkdirSync(path.join(root, 'media'), { recursive: true })
  fs.writeFileSync(path.join(root, 'media', 'hof.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  const tools = contentTools(root)
  const listed = await tools.list_pages.execute!({}, call)
  assert.match((listed as string[]).join('\n'), /alt — Altes — 2020-01-01/)

  const places = await tools.list_places.execute!({}, call)
  assert.match((places as string[]).join('\n'), /rappachgasse — Rappachgasse/)
  const place = await tools.read_place.execute!({ slug: 'rappachgasse' }, call)
  assert.match(String(place), /onPremises: true/)

  const picture = await tools.read_picture.execute!({ file: '/media/hof.png' }, call)
  assert.match(String(picture), /\/media\/hof\.png/)
  assert.match(String(picture), /used 1 time/)

  assert.equal(await tools.delete_page.execute!({ slug: 'home' }, call), 'The home page cannot be removed.')
  assert.equal(fs.existsSync(path.join(root, 'content', 'pages', 'home', 'de.md')), true)

  assert.equal(await tools.delete_page.execute!({ slug: 'alt' }, call), 'Removed page alt.')
  assert.equal(fs.existsSync(path.join(root, 'content', 'pages', 'alt', 'de.md')), false)
  assert.equal(fs.existsSync(path.join(root, 'content', 'pages', 'alt', 'en.md')), false)
  assert.equal(fs.existsSync(path.join(root, 'content', 'pages', 'home', 'de.md')), true)

  assert.equal(await tools.delete_place.execute!({ slug: 'rappachgasse' }, call), 'Removed place rappachgasse.')
  assert.equal(fs.existsSync(path.join(root, 'content', 'places', 'rappachgasse.yml')), false)
  assert.match(fs.readFileSync(path.join(root, 'content', 'events', 'herbstfest.yml'), 'utf8'), /place: rappachgasse/)

  assert.equal(await tools.delete_event.execute!({ slug: 'herbstfest' }, call), 'Removed event herbstfest.')
  assert.equal(fs.existsSync(path.join(root, 'content', 'events', 'herbstfest.yml')), false)

  assert.equal(await tools.discard_picture.execute!({ file: 'hof.png' }, call), 'Discarded /media/hof.png.')
  assert.equal(fs.existsSync(path.join(root, 'media', 'hof.png')), false)
  assert.equal(await tools.delete_page.execute!({ slug: 'missing' }, call), 'Missing page missing')
  assert.equal(await tools.read_picture.execute!({ file: 'hof.png' }, call), 'Unknown picture.')
})
