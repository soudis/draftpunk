import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { bilingualGaps, initSite, readPage, writePage } from '@schlor/generator'
import { documentOpacityRefusal } from './page-opacity'
import { contentTools, designTools, windowText } from './tools'

const call = { toolCallId: 'refine', messages: [] as never[] }

function newSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-refine-'))
  initSite(root)
  return root
}

const NOTE = {
  name: 'note',
  purpose: 'A short note with a badge.',
  slots: { body: { type: 'markdown', required: true }, badge: { type: 'text', translate: false } },
  template: '{% extends "shell.njk" %}{% block body %}<p class="badge">{{ slots.badge }}</p><div>{{ slots.body }}</div>{% endblock %}\n',
}

test('a stylesheet may fade an image and may not hide the page', () => {
  assert.match(documentOpacityRefusal('html.js body { opacity: 0 }') ?? '', /opacity 0 on html or body/)
  assert.match(documentOpacityRefusal('body{opacity:0}') ?? '', /opacity 0 on html or body/)
  assert.match(documentOpacityRefusal('@media screen { html { opacity: 0 } }') ?? '', /opacity 0 on html or body/)
  assert.equal(documentOpacityRefusal('/* body { opacity: 0 } */'), null)
  assert.equal(documentOpacityRefusal('html.js.page-ready body { opacity: 1 }'), null)
  assert.equal(documentOpacityRefusal('.hero img { opacity: 0 }'), null)
  assert.equal(documentOpacityRefusal('body img { opacity: 0 }'), null)
})

test('write_page without a layout writes nothing and names the field, without echoing the body', async () => {
  const root = newSite()
  const tools = contentTools(root)
  const body = 'Ein sehr langer Satz. '.repeat(200)
  await assert.rejects(
    () => tools.write_page.execute!({ slug: 'hall', title: 'Halle', slots: { body } }, call),
    (error: Error) => {
      assert.match(error.message, /layout is required/)
      assert.match(error.message, /Nothing was changed/)
      assert.equal(error.message.includes('Ein sehr langer Satz'), false)
      assert.ok(error.message.length < 200)
      return true
    },
  )
  assert.equal(readPage(root, 'hall'), null)
})

test('write_page checks slots against the layout and writes nothing when one is wrong', async () => {
  const root = newSite()
  const tools = contentTools(root)
  await assert.rejects(
    () => tools.write_page.execute!({ slug: 'hall', layout: 'article', title: { de: 'Halle' }, slots: { body: 'Ein Satz.' } }, call),
    /slots\.body must be an object with one text per language/,
  )
  await assert.rejects(
    () => tools.write_page.execute!({ slug: 'hall', layout: 'article', title: { de: 'Halle' }, slots: { body: { de: 'Ein Satz.' }, extra: 'x' } }, call),
    /unknown slot extra\. This layout has: body/,
  )
  await assert.rejects(
    () => tools.write_page.execute!({ slug: 'hall', layout: 'article', title: { fr: 'Salle' }, slots: { body: { de: 'x' } } }, call),
    /title has unknown language fr; title\.de is required/,
  )
  await assert.rejects(() => tools.write_page.execute!({ slug: 'hall', layout: 'nope', title: { de: 'Halle' } }, call), /Unknown layout nope/)
  assert.equal(readPage(root, 'hall'), null)
})

test('write_page writes the whole page, merges slots, and keeps the date unless it is cleared', async () => {
  const root = newSite()
  const designTool = designTools(root)
  await designTool.write_layout.execute!(NOTE, call)
  const tools = contentTools(root)
  const first = await tools.write_page.execute!(
    { slug: 'neues', layout: 'note', date: '2026-10-01', title: { de: 'Neues', en: 'News' }, slots: { body: { de: 'Heute.', en: 'Today.' }, badge: 'Neu' } },
    call,
  )
  assert.match(String(first), /Wrote page neues \(de, en\) with layout note\./)
  await tools.write_page.execute!({ slug: 'neues', layout: 'note', slots: { body: { de: 'Heute!', en: 'Today!' } } }, call)
  const kept = readPage(root, 'neues')!
  assert.equal(kept.date, '2026-10-01')
  assert.equal(kept.slots.badge, 'Neu')
  assert.deepEqual(kept.slots.body, { de: 'Heute!', en: 'Today!' })
  assert.deepEqual(kept.title, { de: 'Neues', en: 'News' })
  await tools.write_page.execute!({ slug: 'neues', layout: 'note', date: '', slots: { badge: null } }, call)
  const cleared = readPage(root, 'neues')!
  assert.equal(cleared.date, undefined)
  assert.equal('badge' in cleared.slots, false)
  const asJson = await tools.write_page.execute!(
    { slug: 'zweites', layout: 'note', title: JSON.stringify({ de: 'Zweites' }), slots: JSON.stringify({ body: { de: 'Text' } }) } as never,
    call,
  )
  assert.match(String(asJson), /Wrote page zweites/)
  const text = String(await tools.read_page.execute!({ slug: 'neues' }, call))
  assert.match(text, /layout: note/)
  assert.match(text, /Heute!/)
  await assert.rejects(() => tools.read_page.execute!({ slug: 'missing' }, call), /Missing page missing/)
})

test('changing the layout of a page names the slots the new layout does not have', async () => {
  const root = newSite()
  await designTools(root).write_layout.execute!(NOTE, call)
  const tools = contentTools(root)
  await tools.write_page.execute!({ slug: 'neues', layout: 'note', title: { de: 'Neues' }, slots: { body: { de: 'Text.' }, badge: 'Neu' } }, call)
  await assert.rejects(
    () => tools.write_page.execute!({ slug: 'neues', layout: 'article' }, call),
    /unknown slot badge\. This layout has: body/,
  )
  const moved = await tools.write_page.execute!({ slug: 'neues', layout: 'article', slots: { badge: null } }, call)
  assert.match(String(moved), /with layout article/)
  assert.equal(readPage(root, 'neues')!.layout, 'article')
})

test('write_design without a path writes nothing and names path', async () => {
  const root = newSite()
  await assert.rejects(() => designTools(root).write_design.execute!({ content: 'body { color: black; }' }, call), /path is required/)
})

test('a long design file comes back in pieces that name the offset', async () => {
  const root = newSite()
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

test('list_layouts and read_layout show what a layout is for, its slots, and a page that uses it', async () => {
  const root = newSite()
  const tools = designTools(root)
  const catalog = String(await tools.list_layouts.execute!({}, call))
  assert.match(catalog, /- article — A plain text page/)
  assert.match(catalog, /slots: body:markdown\*/)
  assert.match(catalog, /used by: datenschutz, impressum, kontakt/)
  assert.match(catalog, /- calendar — The calendar of upcoming events[^\n]*\n {2}slots: filled by the generator/)
  const read = String(await tools.read_layout.execute!({ name: 'article' }, call))
  assert.match(read, /# layouts\/article\/layout\.yml/)
  assert.match(read, /# layouts\/article\/template\.njk/)
  assert.match(read, /\{\{ slots\.body \}\}/)
  assert.match(read, /# Example: page \w+ uses this layout/)
  const only = String(await tools.read_layout.execute!({ name: 'article', part: 'style' }, call))
  assert.match(only, /# layouts\/article\/style\.css/)
  assert.equal(only.includes('template.njk'), false)
  await assert.rejects(() => tools.read_layout.execute!({ name: 'nope' }, call), /Unknown layout nope/)
})

test('write_layout refuses words and bad slots, keeps the old layout, and reports pages that no longer fit', async () => {
  const root = newSite()
  const tools = designTools(root)
  await assert.rejects(
    () => tools.write_layout.execute!({ ...NOTE, template: '{% extends "shell.njk" %}{% block body %}<p>Mehr erfahren</p>{{ slots.body }}{% endblock %}' }, call),
    /holds the text “Mehr erfahren”.*labels\.name/,
  )
  await assert.rejects(() => tools.write_layout.execute!({ ...NOTE, template: '{{ slots.nope }}' }, call), /reads slots nope/)
  await assert.rejects(() => tools.write_layout.execute!({ ...NOTE, slots: { title: 'text' } }, call), /reserved/)
  await assert.rejects(() => tools.write_layout.execute!({ ...NOTE, style: '.x::after { content: "Neu"; }' }, call), /content rule/)
  await assert.rejects(() => tools.write_layout.execute!({ ...NOTE, name: 'event' }, call), /generated/)
  assert.equal(fs.existsSync(path.join(root, 'design', 'layouts', 'note')), false)

  const created = await tools.write_layout.execute!({ ...NOTE, style: '.badge { color: #3f6f64; }\n' }, call)
  assert.match(String(created), /Wrote layout note\./)
  writePage(root, { slug: 'neues', layout: 'note', title: { de: 'Neues' }, slots: { body: { de: 'Text.' }, badge: 'Neu' } })
  const changed = await tools.write_layout.execute!({ ...NOTE, slots: { body: 'markdown', badge: 'text', must: { type: 'text', required: true } }, template: NOTE.template + '{{ slots.must }}' }, call)
  assert.match(String(changed), /Updated layout note\./)
  assert.match(String(changed), /These pages no longer fit the slots: neues: [^\n]*slots\.must is required/)
  assert.match(fs.readFileSync(path.join(root, 'design', 'layouts', 'note', 'style.css'), 'utf8'), /\.badge/)
  assert.ok(bilingualGaps(root).some((gap) => gap.includes('neues')))
})

test('a design change that stops showing a slot says which words are lost', async () => {
  const root = newSite()
  const tools = designTools(root)
  const file = 'layouts/article/template.njk'
  const original = fs.readFileSync(path.join(root, 'design', file), 'utf8')
  const result = await tools.write_design.execute!({ path: file, content: original.replace('{{ slots.body }}', '') }, call)
  assert.match(String(result), /These words are no longer shown/)
  assert.match(String(result), /kontakt \(de\): slots\.body/)
  const fine = await tools.write_design.execute!({ path: file, content: original }, call)
  assert.equal(String(fine).includes('no longer shown'), false)
})

test('write_design sends layouts to write_layout and checks a template against its slots', async () => {
  const root = newSite()
  const tools = designTools(root)
  await assert.rejects(() => tools.write_design.execute!({ path: 'layouts/article/layout.yml', content: 'slots: {}' }, call), /write_layout/)
  await assert.rejects(() => tools.write_design.execute!({ path: 'layouts/nope/template.njk', content: 'x' }, call), /Unknown layout nope/)
  await assert.rejects(
    () => tools.write_design.execute!({ path: 'layouts/article/template.njk', content: '{{ slots.body }}{{ slots.other }}' }, call),
    /reads slots other/,
  )
  await assert.rejects(() => tools.write_design.execute!({ path: 'shell.njk', content: '<footer>Alle Rechte vorbehalten</footer>' }, call), /holds the text/)
  await assert.rejects(() => tools.write_design.execute!({ path: 'layouts/../x.css', content: 'x' }, call), /not allowed/)
})

test('fork, replace and delete move layouts without losing a page', async () => {
  const root = newSite()
  const tools = designTools(root)
  await tools.write_layout.execute!(NOTE, call)
  assert.match(String(await tools.fork_layout.execute!({ from: 'note', to: 'note-wide' }, call)), /Forked layout note to note-wide/)
  await assert.rejects(() => tools.fork_layout.execute!({ from: 'note', to: 'note-wide' }, call), /exists/)
  writePage(root, { slug: 'neues', layout: 'note-wide', title: { de: 'Neues' }, slots: { body: { de: 'Text.' } } })
  await assert.rejects(() => tools.delete_layout.execute!({ name: 'note-wide' }, call), /used by neues\. Use replace_layout/)
  const moved = await tools.replace_layout.execute!({ from: 'note-wide', to: 'article' }, call)
  assert.match(String(moved), /Moved neues from note-wide to article/)
  assert.equal(readPage(root, 'neues')!.layout, 'article')
  assert.match(String(await tools.delete_layout.execute!({ name: 'note' }, call)), /Removed layout note/)
  assert.equal(fs.existsSync(path.join(root, 'design', 'layouts', 'note')), false)
  await assert.rejects(() => tools.replace_layout.execute!({ from: 'event', to: 'article' }, call), /part of the calendar/)
})

test('write_design refuses a blank page and keeps an image fade', async () => {
  const root = newSite()
  const file = path.join(root, 'design', 'styles.css')
  const original = fs.readFileSync(file, 'utf8')
  const tools = designTools(root)
  await assert.rejects(
    () => tools.write_design.execute!({ path: 'styles.css', content: `${original}\nhtml.js body { opacity: 0 }\n` }, call),
    /opacity 0 on html or body/,
  )
  assert.equal(fs.readFileSync(file, 'utf8'), original)
  const kept = await tools.write_design.execute!({ path: 'styles.css', content: `${original}\n.hero img { opacity: 0 }\n` }, call)
  assert.match(String(kept), /Updated design\/styles\.css/)
  assert.match(String(kept), /rewrite design\/brief\.md/)
  assert.match(fs.readFileSync(file, 'utf8'), /\.hero img \{ opacity: 0 \}/)
})
