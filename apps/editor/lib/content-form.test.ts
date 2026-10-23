import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { contentEntries, contentPath, designTextEntries, fromWall, putBack, readContentForm, readDesignText, toWall, writeContentForm } from './content-form'
import { ensureGit } from './git'

function site(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-form-'))
  ensureGit(root)
  fs.mkdirSync(path.join(root, 'content', 'events'), { recursive: true })
  fs.mkdirSync(path.join(root, 'content', 'places'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'content', 'places', 'hof.yml'),
    'slug: hof\nname:\n  de: Hof\n  en: Yard\naddress: Hofgasse 1\nonPremises: true\nkeep: me\n',
  )
  fs.writeFileSync(
    path.join(root, 'content', 'events', 'sommer.yml'),
    'slug: sommer\ntitle:\n  de: Sommerfest\n  en: ""\nbody:\n  de: Wir feiern.\n  en: ""\nplace: hof\ncategories: []\ndates:\n  - start: 2026-07-04T16:00:00.000Z\n    end: 2026-07-04T20:00:00.000Z\nextra: stays\n',
  )
  return root
}

const read = (root: string, file: string) => readContentForm(root, file)

test('only content files can be opened', () => {
  const root = site()
  assert.throws(() => contentPath(root, 'design/styles.css'))
  assert.throws(() => contentPath(root, 'content/pages/../../secret.yml'))
  assert.throws(() => contentPath(root, 'content/events/a/b.yml'))
  assert.equal(contentPath(root, 'content/pages/kontakt.yml').kind, 'page')
  assert.equal(contentPath(root, 'content/home.yml').kind, 'home')
})

test('the browser lists pages, events, places and the two list files, and the readable design texts', () => {
  const root = site()
  const entries = contentEntries(root)
  const kinds = new Set(entries.map((entry) => entry.kind))
  for (const kind of ['page', 'event', 'place', 'home', 'redirects']) assert.ok(kinds.has(kind as never), kind)
  assert.equal(entries.find((entry) => entry.file === 'content/events/sommer.yml')?.title, 'Sommerfest')
  assert.ok(designTextEntries(root).some((entry) => entry.file === 'design/brief.md'))
  assert.ok(readDesignText(root, 'design/brief.md').length > 0)
  assert.throws(() => readDesignText(root, 'design/styles.css'))
  assert.throws(() => readDesignText(root, 'design/../content/home.yml'))
})

test('a page form follows the slots of its layout and saves the changed text', () => {
  const root = site()
  const form = read(root, 'content/pages/kontakt.yml')
  assert.equal(form.layout, 'article')
  const slots = form.fields.find((field) => field.key === 'slots')
  assert.ok(slots?.fields?.some((field) => field.key === 'body' && field.type === 'markdown' && field.translate))
  const values = structuredClone(form.values) as { slots: { body: Record<string, string> } }
  values.slots.body.de = 'Neuer **Text**.'
  const saved = writeContentForm(root, form.file, values, form.revision)
  assert.ok(saved.ok)
  assert.match(fs.readFileSync(path.join(root, form.file), 'utf8'), /Neuer \*\*Text\*\*/)
  assert.notEqual(read(root, form.file).revision, form.revision)
})

test('a page with a missing language still saves, and an unknown slot does not', () => {
  const root = site()
  const form = read(root, 'content/pages/kontakt.yml')
  const values = structuredClone(form.values) as { title: Record<string, string>; slots: Record<string, unknown> }
  values.title.en = ''
  assert.ok(writeContentForm(root, form.file, values, form.revision).ok)
  const again = read(root, form.file)
  const bad = structuredClone(again.values) as { slots: Record<string, unknown> }
  bad.slots.nonsense = 'x'
  const refused = writeContentForm(root, form.file, bad, again.revision)
  assert.equal(refused.ok, false)
  assert.equal(read(root, form.file).revision, again.revision)
})

test('a save from a stale form is refused and leaves the file alone', () => {
  const root = site()
  const form = read(root, 'content/pages/kontakt.yml')
  fs.appendFileSync(path.join(root, form.file), '# someone else\n')
  const refused = writeContentForm(root, form.file, form.values, form.revision)
  assert.equal(refused.ok, false)
  assert.equal(refused.ok === false && refused.stale, true)
  assert.match(fs.readFileSync(path.join(root, form.file), 'utf8'), /someone else/)
})

test('an event keeps its unknown keys and the dates the person did not touch', () => {
  const root = site()
  const form = read(root, 'content/events/sommer.yml')
  assert.equal((form.values.dates as { start: string }[])[0].start, '2026-07-04T18:00')
  const values = structuredClone(form.values) as { title: Record<string, string>; dates: { start: string; end: string }[] }
  values.title.en = 'Summer party'
  const saved = writeContentForm(root, form.file, values, form.revision)
  assert.ok(saved.ok)
  const text = fs.readFileSync(path.join(root, form.file), 'utf8')
  assert.match(text, /extra: stays/)
  assert.match(text, /Summer party/)
  assert.match(text, /2026-07-04T16:00:00\.000Z/)
})

test('an event date that was changed is stored as the UTC moment of the site time zone', () => {
  const root = site()
  const form = read(root, 'content/events/sommer.yml')
  const values = structuredClone(form.values) as { dates: { start: string; end: string }[] }
  values.dates[0].start = '2026-07-05T19:00'
  values.dates[0].end = '2026-07-05T22:30'
  assert.ok(writeContentForm(root, form.file, values, form.revision).ok)
  const text = fs.readFileSync(path.join(root, form.file), 'utf8')
  assert.match(text, /2026-07-05T17:00:00\.000Z/)
  assert.match(text, /2026-07-05T20:30:00\.000Z/)
})

test('an event is refused with an unknown place, no date, or an end before its start', () => {
  const root = site()
  const form = read(root, 'content/events/sommer.yml')
  const change = (edit: (values: Record<string, unknown>) => void) => {
    const values = structuredClone(form.values)
    edit(values)
    return writeContentForm(root, form.file, values, form.revision)
  }
  assert.equal(change((values) => { values.place = 'nowhere' }).ok, false)
  assert.equal(change((values) => { values.dates = [] }).ok, false)
  assert.equal(change((values) => { values.dates = [{ start: '2026-07-05T19:00', end: '2026-07-05T18:00' }] }).ok, false)
  assert.equal(read(root, form.file).revision, form.revision)
})

test('a place and the two list files save', () => {
  const root = site()
  const place = read(root, 'content/places/hof.yml')
  const placeValues = structuredClone(place.values) as { address: string; onPremises: boolean }
  placeValues.address = ''
  placeValues.onPremises = false
  assert.ok(writeContentForm(root, place.file, placeValues, place.revision).ok)
  const saved = fs.readFileSync(path.join(root, place.file), 'utf8')
  assert.match(saved, /onPremises: false/)
  assert.doesNotMatch(saved, /address/)
  assert.match(saved, /keep: me/)

  const home = read(root, 'content/home.yml')
  assert.equal(writeContentForm(root, home.file, { news: ['nowhere'] }, home.revision).ok, false)
  assert.ok(writeContentForm(root, home.file, { news: ['kontakt'] }, home.revision).ok)

  const redirects = read(root, 'content/redirects.yml')
  assert.equal(writeContentForm(root, redirects.file, { redirects: [{ from: 'old', to: '/new/' }] }, redirects.revision).ok, false)
  assert.ok(writeContentForm(root, redirects.file, { redirects: [{ from: '/old/', to: '/new/' }] }, redirects.revision).ok)
  assert.deepEqual(read(root, redirects.file).values.redirects, [{ from: '/old/', to: '/new/' }])
})

test('a file can be put back after a save that did not build', () => {
  const root = site()
  const form = read(root, 'content/pages/kontakt.yml')
  const saved = writeContentForm(root, form.file, { ...form.values, title: { de: 'Anders', en: 'Else' } }, form.revision)
  assert.ok(saved.ok)
  putBack(root, form.file, saved.ok ? saved.previous : Buffer.alloc(0))
  assert.equal(read(root, form.file).revision, form.revision)
})

test('wall clock times follow the site time zone, with the summer shift', () => {
  assert.equal(toWall('2026-07-04T16:00:00.000Z', 'Europe/Vienna'), '2026-07-04T18:00')
  assert.equal(toWall('2026-01-04T16:00:00.000Z', 'Europe/Vienna'), '2026-01-04T17:00')
  assert.equal(toWall('2026-07-04T18:00', 'Europe/Vienna'), '2026-07-04T18:00')
  assert.equal(fromWall('2026-07-04T18:00', 'Europe/Vienna'), '2026-07-04T16:00:00.000Z')
  assert.equal(fromWall('2026-01-04T17:00', 'Europe/Vienna'), '2026-01-04T16:00:00.000Z')
  assert.equal(fromWall(toWall('2026-03-29T01:30:00.000Z', 'Europe/Vienna'), 'Europe/Vienna'), '2026-03-29T01:30:00.000Z')
})
