import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { bilingualGaps, contentPagePath, initSite, readPageFile, writePageFile } from '@schlor/generator'
import { documentOpacityRefusal } from './page-opacity'
import { contentTools, designTools, windowText } from './tools'

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

test('write_page without languages writes nothing and names the field, without echoing the body', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const tools = contentTools(root)
  const body = 'Ein sehr langer Satz. '.repeat(200)
  await assert.rejects(
    () => tools.write_page.execute!({ slug: 'hall', layout: 'article', title: 'Halle', body }, call),
    (error: Error) => {
      assert.match(error.message, /languages is required/)
      assert.match(error.message, /Nothing was changed/)
      assert.equal(error.message.includes('Ein sehr langer Satz'), false)
      assert.ok(error.message.length < 200)
      return true
    },
  )
  assert.equal(fs.existsSync(contentPagePath(root, 'hall', 'de')), false)
})

test('write_page writes every language in one call and refuses when a required one is missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const site = path.join(root, 'design', 'site.yml')
  fs.writeFileSync(site, fs.readFileSync(site, 'utf8').replace('optional: true', 'optional: false'))
  const tools = contentTools(root)
  await assert.rejects(
    () => tools.write_page.execute!({ slug: 'hall', layout: 'article', languages: { de: { title: 'Halle', body: 'Ein Satz.' } } }, call),
    /Missing English \(en\)/,
  )
  assert.equal(fs.existsSync(contentPagePath(root, 'hall', 'de')), false)
  await assert.rejects(
    () => tools.write_page.execute!({ slug: 'hall', layout: 'article', languages: { fr: { title: 'Salle', body: 'Une phrase.' } } }, call),
    /Unknown language fr/,
  )
  const result = await tools.write_page.execute!(
    {
      slug: 'hall',
      layout: 'article',
      languages: { de: { title: 'Halle', body: 'Ein Satz.' }, en: { title: 'Hall', body: 'A sentence.' } },
    },
    call,
  )
  assert.match(String(result), /Wrote page hall \(de, en\) with layout article/)
  assert.equal(readPageFile(contentPagePath(root, 'hall', 'en'), 'hall', 'en').title, 'Hall')
  assert.equal(readPageFile(contentPagePath(root, 'hall', 'de'), 'hall', 'de').body.trim(), 'Ein Satz.')
})

test('a JSON string for languages is accepted, and the date stays unless it is cleared', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const tools = contentTools(root)
  const languages = JSON.stringify({ de: { title: 'Neues', body: 'Heute.' } })
  await tools.write_page.execute!({ slug: 'neues', layout: 'article', date: '2026-10-01', languages } as never, call)
  const file = contentPagePath(root, 'neues', 'de')
  assert.equal(readPageFile(file, 'neues', 'de').date, '2026-10-01')
  await tools.write_page.execute!({ slug: 'neues', layout: 'article', languages: { de: { title: 'Neues', body: 'Heute!' } } }, call)
  assert.equal(readPageFile(file, 'neues', 'de').date, '2026-10-01')
  await tools.write_page.execute!({ slug: 'neues', layout: 'article', date: '', languages: { de: { title: 'Neues', body: 'Heute!' } } }, call)
  assert.equal(readPageFile(file, 'neues', 'de').date, undefined)
})

test('write_design without a path writes nothing and names path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const tools = designTools(root)
  await assert.rejects(() => tools.write_design.execute!({ content: 'body { color: black; }' }, call), /path is required/)
})

test('read_design points at the layout file that exists and names the fields it shows', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const tools = designTools(root)
  await assert.rejects(() => tools.read_design.execute!({ path: 'layouts/room.njk' }, call), /layouts\/room\.yml/)
  await assert.rejects(() => tools.read_design.execute!({ path: 'kit.njk' }, call), /Kit shapes are not a file in the site/)
  const room = await tools.read_design.execute!({ path: 'layouts/room.yml' }, call)
  assert.match(String(room), /pictures shows images/)
  fs.writeFileSync(path.join(root, 'design', 'layouts', 'room.njk'), '{% extends "shell.njk" %}\n')
  const both = await tools.read_design.execute!({ path: 'layouts/room.yml' }, call)
  assert.match(String(both), /layouts\/room\.njk is what renders/)
  const listed = await tools.list_design.execute!({}, call)
  assert.match(JSON.stringify(listed), /room\.yml — section list/)
  assert.match(JSON.stringify(listed), /event\.njk — private template/)
})

test('a long design file comes back in pieces that name the offset', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const long = `${'.a { color: red }\n'.repeat(2000)}.last { color: blue }\n`
  fs.writeFileSync(path.join(root, 'design', 'styles.css'), long)
  const tools = designTools(root)
  const first = String(await tools.read_design.execute!({ path: 'styles.css' }, call))
  assert.ok(first.length < long.length)
  const next = /Call again with offset (\d+)/.exec(first)
  assert.ok(next)
  const rest = String(await tools.read_design.execute!({ path: 'styles.css', offset: Number(next[1]) }, call))
  assert.match(rest, /\.last \{ color: blue \}/)
  assert.match(rest, /That is the end/)
  assert.equal(windowText('short', 0), 'short')
})

test('write_page names a field the section list will not show, and a layout that a language still uses', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const tools = contentTools(root)
  writePageFile(contentPagePath(root, 'hall', 'en'), { layout: 'article', title: 'Hall', body: 'A room.', data: {} })
  const result = await tools.write_page.execute!(
    {
      slug: 'hall',
      layout: 'room',
      languages: { de: { title: 'Halle', body: 'Ein Raum.' } },
      fields: { pictures: [{ alt: 'Eingang' }], emailLabel: 'Kontakt' },
    },
    call,
  )
  assert.match(String(result), /Use images for the pictures section/)
  assert.match(String(result), /en still uses layout article/)
  assert.match(fs.readFileSync(contentPagePath(root, 'hall', 'de'), 'utf8'), /layout: room/)
})

test('a private template does not warn about a slot name', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  fs.writeFileSync(path.join(root, 'design', 'layouts', 'note.njk'), '{% extends "shell.njk" %}{% block body %}{{ slots.badge }}{% endblock %}\n')
  const tools = contentTools(root)
  const result = await tools.write_page.execute!(
    { slug: 'hall', layout: 'note', languages: { de: { title: 'Halle', body: 'Ein Satz.' } }, fields: { badge: 'Neu' } },
    call,
  )
  assert.equal(String(result).includes('badge is not shown'), false)
  assert.match(String(result), /Wrote page hall/)
})

test('a page whose layout reads slots is complete without a body', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const site = path.join(root, 'design', 'site.yml')
  fs.writeFileSync(site, fs.readFileSync(site, 'utf8').replace('optional: true', 'optional: false'))
  writePageFile(contentPagePath(root, 'hall', 'de'), { layout: 'note', title: 'Halle', body: '', data: { badge: 'Neu' } })
  writePageFile(contentPagePath(root, 'hall', 'en'), { layout: 'note', title: 'Hall', body: '', data: { badge: 'New' } })
  writePageFile(contentPagePath(root, 'empty', 'de'), { layout: 'note', title: 'Leer', body: '', data: {} })
  const gaps = bilingualGaps(root)
  assert.equal(gaps.some((gap) => gap.startsWith('page hall')), false)
  assert.equal(gaps.includes('page empty de'), true)
})

test('write_design refuses a blank page and keeps an image fade', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  const file = path.join(root, 'design', 'styles.css')
  const original = fs.readFileSync(file, 'utf8')
  const tools = designTools(root)
  await assert.rejects(
    () => tools.write_design.execute!({ path: 'styles.css', content: `${original}\nhtml.js body { opacity: 0 }\n` }, call),
    /opacity 0 on html or body/,
  )
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
