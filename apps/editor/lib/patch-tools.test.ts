import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, readLayout, readPage, writePage } from '@schlor/generator'
import { replaceOnce } from './edit'
import { slotDefAt, slotPath, withValueAt } from './slot-edit'
import { contentTools, designTools } from './tools'

const call = { toolCallId: 'patch', messages: [] as never[] }

function newSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-patch-'))
  initSite(root)
  return root
}

function room(root: string) {
  return designTools(root).write_layout.execute!(
    {
      name: 'room',
      purpose: 'A room page.',
      slots: {
        body: { type: 'markdown', required: true },
        facts: { type: 'list', of: { label: 'text', value: { type: 'text', translate: false } } },
        photo: 'image',
      },
      template:
        '{% extends "shell.njk" %}{% block body %}<h1>{{ title }}</h1>{{ slots.body }}{% for f in slots.facts %}<p class="fact">{{ f.label }}: {{ f.value }}</p>{% endfor %}<img src="{{ slots.photo }}" alt="">{% endblock %}',
      style: '.fact { color: var(--color-primary); }\n',
    },
    call,
  )
}

test('replace finds one exact place, and says why it cannot', () => {
  assert.deepEqual(replaceOnce('a b c', 'b', 'x', 'f'), { text: 'a x c', count: 1 })
  assert.deepEqual(replaceOnce('a b b', 'b', 'x', 'f', true), { text: 'a x x', count: 2 })
  assert.deepEqual(replaceOnce('cost $1', '$1', '$2', 'f'), { text: 'cost $2', count: 1 })
  assert.throws(() => replaceOnce('a b b', 'b', 'x', 'f'), /appears 2 times\. Add surrounding text/)
  assert.throws(() => replaceOnce('a b', 'z', 'x', 'f'), /that text is not there/)
  assert.throws(() => replaceOnce('one  two\nthree', 'one two three', 'x', 'f'), /different spacing or line breaks: "one {2}two\\nthree"/)
  assert.throws(() => replaceOnce('a', '', 'x', 'f'), /find is empty/)
})

test('a slot path names a place, and a bad path says what is there', () => {
  const schema = readLayout(path.join(newSite(), 'design'), 'home').slots
  assert.deepEqual(slotPath('cards.2.title'), ['cards', 2, 'title'])
  assert.equal(slotDefAt(schema, slotPath('cards.2.title')).type, 'text')
  assert.equal(slotDefAt(schema, slotPath('band.href')).type, 'link')
  assert.throws(() => slotDefAt(schema, slotPath('nope')), /Unknown slot nope\. This layout has: lede, hero_image, body, cards, band/)
  assert.throws(() => slotDefAt(schema, slotPath('cards.title')), /cards is a list\. Use an index/)
  assert.throws(() => slotDefAt(schema, slotPath('band.nope')), /band has the fields title, text, label, href/)
  assert.throws(() => slotDefAt(schema, slotPath('lede.de')), /lede is text, so there is nothing below it/)
  const slots = withValueAt({ cards: [{ title: { de: 'A' } }] }, ['cards', 1, 'title'], { de: 'B' })
  assert.deepEqual(slots, { cards: [{ title: { de: 'A' } }, { title: { de: 'B' } }] })
  assert.throws(() => withValueAt({ cards: [] }, ['cards', 3], {}), /too far\. Use 0 to add one/)
  assert.deepEqual(withValueAt({ cards: [1, 2, 3] }, ['cards', 1], null), { cards: [1, 3] })
})

test('edit_slot changes a few words and nothing else on the page', async () => {
  const root = newSite()
  await room(root)
  writePage(root, {
    slug: 'raum',
    layout: 'room',
    title: { de: 'Raum', en: 'Room' },
    slots: { body: { de: 'Der Raum hat 60 m². Er ist hell.', en: 'The room has 60 m². It is bright.' }, facts: [{ label: { de: 'Größe', en: 'Size' }, value: '60 m²' }], photo: '/media/raum.jpg' },
  })
  const tools = contentTools(root)
  const result = await tools.edit_slot.execute!({ slug: 'raum', slot: 'body', lang: 'de', find: '60 m²', replace: '68 m²' }, call)
  assert.match(String(result), /Replaced one match in slots\.body \(de\) of page raum/)
  const page = readPage(root, 'raum')!
  assert.deepEqual(page.slots.body, { de: 'Der Raum hat 68 m². Er ist hell.', en: 'The room has 60 m². It is bright.' })
  assert.deepEqual(page.title, { de: 'Raum', en: 'Room' })
  assert.equal(page.slots.photo, '/media/raum.jpg')
  await tools.edit_slot.execute!({ slug: 'raum', slot: 'facts.0.label', lang: 'en', find: 'Size', replace: 'Area' }, call)
  assert.deepEqual((readPage(root, 'raum')!.slots.facts as { label: object }[])[0].label, { de: 'Größe', en: 'Area' })
  await assert.rejects(() => tools.edit_slot.execute!({ slug: 'raum', slot: 'body', find: 'a', replace: 'b' }, call), /body is translated\. Send lang: de or en/)
  await assert.rejects(() => tools.edit_slot.execute!({ slug: 'raum', slot: 'photo', find: 'a', replace: 'b' }, call), /photo is image\. edit_slot changes text/)
  await assert.rejects(() => tools.edit_slot.execute!({ slug: 'raum', slot: 'body', lang: 'de', find: ' ', replace: '_' }, call), /appears \d+ times/)
  await assert.rejects(() => tools.edit_slot.execute!({ slug: 'nope', slot: 'body', lang: 'de', find: 'a', replace: 'b' }, call), /Missing page nope/)
  await tools.edit_slot.execute!({ slug: 'raum', slot: 'body', lang: 'de', find: ' ', replace: '_', all: true }, call)
  assert.equal((readPage(root, 'raum')!.slots.body as { de: string }).de, 'Der_Raum_hat_68_m²._Er_ist_hell.')
})

test('set_slot replaces one value, adds a list item, and removes one', async () => {
  const root = newSite()
  await room(root)
  writePage(root, {
    slug: 'raum',
    layout: 'room',
    title: { de: 'Raum', en: 'Room' },
    slots: { body: { de: 'Text.', en: 'Text.' }, facts: [{ label: { de: 'Größe', en: 'Size' }, value: '60 m²' }] },
  })
  const tools = contentTools(root)
  await tools.set_slot.execute!({ slug: 'raum', slot: 'photo', value: '/media/neu.jpg' }, call)
  await tools.set_slot.execute!({ slug: 'raum', slot: 'facts.1', value: { label: { de: 'Plätze', en: 'Seats' }, value: '50' } }, call)
  await tools.set_slot.execute!({ slug: 'raum', slot: 'body', lang: 'en', value: 'New text.' }, call)
  let page = readPage(root, 'raum')!
  assert.equal(page.slots.photo, '/media/neu.jpg')
  assert.equal((page.slots.facts as unknown[]).length, 2)
  assert.deepEqual(page.slots.body, { de: 'Text.', en: 'New text.' })
  await tools.set_slot.execute!({ slug: 'raum', slot: 'facts.0', value: null }, call)
  page = readPage(root, 'raum')!
  assert.deepEqual((page.slots.facts as { value: string }[]).map((fact) => fact.value), ['50'])
  await assert.rejects(() => tools.set_slot.execute!({ slug: 'raum', slot: 'photo', value: 'neu.jpg' }, call), /slots\.photo must be a picture address/)
  await assert.rejects(() => tools.set_slot.execute!({ slug: 'raum', slot: 'body', value: 'plain' }, call), /slots\.body must be an object with one text per language/)
  await assert.rejects(() => tools.set_slot.execute!({ slug: 'raum', slot: 'body', value: null }, call), /slots\.body is required/)
  await assert.rejects(() => tools.set_slot.execute!({ slug: 'raum', slot: 'photo', lang: 'de', value: 'x' }, call), /not translated text/)
  assert.equal(readPage(root, 'raum')!.slots.photo, '/media/neu.jpg')
})

test('edit_design and edit_layout change a small piece and run the same checks as a full write', async () => {
  const root = newSite()
  await room(root)
  const design = designTools(root)
  const styles = path.join(root, 'design', 'styles.css')
  const tokens = path.join(root, 'design', 'tokens.yml')
  const result = await design.edit_design.execute!({ path: 'tokens.yml', find: 'primary: "#3f6f64"', replace: 'primary: "#1f5f54"' }, call)
  assert.match(String(result), /Replaced one match in design\/tokens\.yml\. Updated design\/tokens\.yml/)
  assert.match(fs.readFileSync(tokens, 'utf8'), /primary: "#1f5f54"/)
  assert.match(fs.readFileSync(path.join(root, 'dist', 'assets', 'styles.css'), 'utf8'), /--color-primary:\s*#1f5f54/)
  await assert.rejects(
    () => design.edit_design.execute!({ path: 'styles.css', find: '.prose :where(a) {', replace: '}\nhtml { opacity: 0 }\n.x {' }, call),
    /opacity 0 on html or body/,
  )
  assert.match(fs.readFileSync(styles, 'utf8'), /\.prose :where\(a\) \{/)
  await assert.rejects(() => design.edit_design.execute!({ path: 'shell.njk', find: '<footer', replace: '<footer>Alle Rechte vorbehalten</footer><footer' }, call), /holds the text/)
  await assert.rejects(() => design.edit_design.execute!({ path: 'styles.css', find: 'nothing like this', replace: 'x' }, call), /that text is not there/)
  await assert.rejects(() => design.edit_design.execute!({ path: 'layouts/room/layout.yml', find: 'purpose:', replace: 'purpose:' }, call), /edit_layout/)

  const style = await design.edit_layout.execute!({ name: 'room', part: 'style', find: 'var(--color-primary)', replace: 'tomato' }, call)
  assert.match(String(style), /Replaced one match in layouts\/room\/style\.css\. Updated layout room\./)
  assert.match(fs.readFileSync(path.join(root, 'design', 'layouts', 'room', 'style.css'), 'utf8'), /tomato/)
  const slots = await design.edit_layout.execute!({ name: 'room', part: 'layout', find: 'photo: image', replace: 'photo: image\n  note: text' }, call)
  assert.match(String(slots), /declared but template\.njk never shows them/)
  assert.equal(readLayout(path.join(root, 'design'), 'room').slots.note.type, 'text')
  const purpose = await design.edit_layout.execute!({ name: 'room', part: 'layout', find: 'A room page.', replace: 'A page for one room.' }, call)
  assert.match(String(purpose), /Updated layout room/)
  assert.equal(readLayout(path.join(root, 'design'), 'room').purpose, 'A page for one room.')
  await assert.rejects(() => design.edit_layout.execute!({ name: 'room', part: 'template', find: '{{ slots.body }}', replace: '{{ slots.nope }}' }, call), /reads slots nope/)
  await assert.rejects(() => design.edit_layout.execute!({ name: 'room', part: 'layout', find: 'purpose:', replace: 'purpose: [' }, call), /not valid YAML|purpose/)
  await assert.rejects(() => design.edit_layout.execute!({ name: 'nope', part: 'style', find: 'a', replace: 'b' }, call), /Unknown layout nope/)
  assert.match(fs.readFileSync(path.join(root, 'design', 'layouts', 'room', 'template.njk'), 'utf8'), /slots\.body/)
})

test('a small edit is a small tool call', () => {
  const edit = JSON.stringify({ path: 'tokens.yml', find: 'primary: "#3f6f64"', replace: 'primary: "#1f5f54"' })
  const stylesheet = fs.readFileSync(path.join(newSite(), 'design', 'tokens.yml'), 'utf8')
  assert.ok(edit.length < stylesheet.length / 3, `${edit.length} against ${stylesheet.length}`)
  assert.ok(edit.length < 100)
})
