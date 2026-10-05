import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { contentPagePath, initSite, writePageFile } from '@schlor/generator'
import { documentOpacityRefusal } from './page-opacity'
import { contentTools, designTools } from './tools'

const call = { toolCallId: 'refine', messages: [] as never[] }

test('a stylesheet may fade an image and may not hide the page', () => {
  assert.match(documentOpacityRefusal('html.js body { opacity: 0 }') ?? '', /opacity 0 on html or body/)
  assert.match(documentOpacityRefusal('body{opacity:0}') ?? '', /opacity 0 on html or body/)
  assert.match(documentOpacityRefusal('@media screen { html { opacity: 0 } }') ?? '', /opacity 0 on html or body/)
  assert.equal(documentOpacityRefusal('/* body { opacity: 0 } */'), null)
  assert.equal(documentOpacityRefusal('html.js.page-ready body { opacity: 1 }'), null)
  assert.equal(documentOpacityRefusal('.hero img { opacity: 0 }'), null)
  assert.equal(documentOpacityRefusal('body img { opacity: 0 }'), null)
})

test('write_page without lang writes nothing and names lang', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const tools = contentTools(root)
  const result = await tools.write_page.execute!(
    { slug: 'hall', title: 'Halle', layout: 'article', body: 'Ein Satz.' },
    call,
  )
  assert.match(String(result), /Nothing was written/)
  assert.match(String(result), /lang/)
  assert.equal(fs.existsSync(contentPagePath(root, 'hall', 'de')), false)
})

test('write_design without a path writes nothing and names path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const tools = designTools(root)
  const result = await tools.write_design.execute!({ content: 'body { color: black; }' }, call)
  assert.match(String(result), /Nothing was written/)
  assert.match(String(result), /path/)
})

test('read_design points at the layout file that exists and names the fields it shows', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const tools = designTools(root)
  const missing = await tools.read_design.execute!({ path: 'layouts/room.njk' }, call)
  assert.match(String(missing), /layouts\/room\.yml/)
  const kit = await tools.read_design.execute!({ path: 'kit.njk' }, call)
  assert.match(String(kit), /Kit shapes are not a file in the site/)
  const room = await tools.read_design.execute!({ path: 'layouts/room.yml' }, call)
  assert.match(String(room), /pictures shows images/)
  fs.writeFileSync(path.join(root, 'design', 'layouts', 'room.njk'), '{% extends "shell.njk" %}\n')
  const both = await tools.read_design.execute!({ path: 'layouts/room.yml' }, call)
  assert.match(String(both), /layouts\/room\.njk is what renders/)
  const listed = await tools.list_design.execute!({}, call)
  assert.match(JSON.stringify(listed), /room\.yml — section list/)
  assert.match(JSON.stringify(listed), /event\.njk — private template/)
})

test('write_page names a field the section list will not show, and a missing required language', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const site = path.join(root, 'design', 'site.yml')
  fs.writeFileSync(site, fs.readFileSync(site, 'utf8').replace('optional: true', 'optional: false'))
  const tools = contentTools(root)
  const missing = await tools.write_page.execute!(
    {
      slug: 'hall',
      lang: 'de',
      title: 'Halle',
      layout: 'room',
      body: 'Ein Raum.',
      fields: { pictures: [{ alt: 'Eingang' }], emailLabel: 'Kontakt' },
    },
    call,
  )
  assert.match(String(missing), /Use images for the pictures section/)
  assert.match(String(missing), /en is missing/)
  const page = fs.readFileSync(contentPagePath(root, 'hall', 'de'), 'utf8')
  assert.match(page, /layout: room/)
  writePageFile(contentPagePath(root, 'hall', 'en'), { layout: 'article', title: 'Hall', body: 'A room.', data: {} })
  const drifted = await tools.write_page.execute!(
    { slug: 'hall', lang: 'de', title: 'Halle', layout: 'room', body: 'Ein Raum.' },
    call,
  )
  assert.match(String(drifted), /en still uses layout article/)
})

test('a private template does not warn about a slot name', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  fs.writeFileSync(path.join(root, 'design', 'layouts', 'note.njk'), '{% extends "shell.njk" %}{% block body %}{{ slots.badge }}{% endblock %}\n')
  const tools = contentTools(root)
  const result = await tools.write_page.execute!(
    { slug: 'hall', lang: 'de', title: 'Halle', layout: 'note', body: 'Ein Satz.', fields: { badge: 'Neu' } },
    call,
  )
  assert.equal(String(result).includes('badge is not shown'), false)
  assert.match(String(result), /Wrote page hall/)
})

test('write_design refuses a blank page and keeps an image fade', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const file = path.join(root, 'design', 'styles.css')
  const original = fs.readFileSync(file, 'utf8')
  const tools = designTools(root)
  const refused = await tools.write_design.execute!(
    { path: 'styles.css', content: `${original}\nhtml.js body { opacity: 0 }\n` },
    call,
  )
  assert.match(String(refused), /opacity 0 on html or body/)
  assert.equal(fs.readFileSync(file, 'utf8'), original)
  const kept = await tools.write_design.execute!(
    { path: 'styles.css', content: `${original}\n.hero img { opacity: 0 }\n` },
    call,
  )
  assert.match(String(kept), /Updated design\/styles\.css/)
  assert.match(String(kept), /Rewrite the shared look/)
  assert.match(String(kept), /leave the layout lines/)
  assert.match(fs.readFileSync(file, 'utf8'), /\.hero img \{ opacity: 0 \}/)
})
