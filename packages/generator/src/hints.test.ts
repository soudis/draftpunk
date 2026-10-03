import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generate, initSite, readYaml } from './index'
import { applyContentCorrection, markContent, revealContentHints } from './hints'
import type { EventDoc, PlaceDoc } from './content'

const TWICE = 'That phrase appears twice in this text.'
const NOT_IN = 'That text is not in the content.'
const HINT = 'That hint is not a content field.'

test('hints become data-content and stay out of attributes', () => {
  const title = `<h1>${markContent('Hof', { file: 'content/pages/home/de.md', field: 'title' })}</h1>`
  const revealed = revealContentHints(title)
  assert.match(revealed, /<span data-content="content\/pages\/home\/de\.md\|title">Hof<\/span>/)
  const body = revealContentHints(markContent('<p>Hof</p>', { file: 'content/pages/home/de.md', field: 'body', block: 0 }))
  assert.match(body, /<p data-content="content\/pages\/home\/de\.md\|body\|0">Hof<\/p>/)
  const image = `<img src="${markContent('/media/hof.jpg', { file: 'content/pages/home/de.md', field: 'hero.image' })}" alt="">`
  const stripped = revealContentHints(image)
  assert.equal(stripped.includes('data-content'), false)
  assert.match(stripped, /src="\/media\/hof\.jpg"/)
  assert.equal(stripped.includes('\uE000'), false)
})

test('a correction writes the hinted field and leaves the same words elsewhere', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hint-correct-'))
  const page = path.join(root, 'content', 'pages', 'home', 'de.md')
  const english = path.join(root, 'content', 'pages', 'home', 'en.md')
  fs.mkdirSync(path.dirname(page), { recursive: true })
  fs.writeFileSync(
    page,
    `---
layout: home
title: Hof
hero:
  lede: A house.
---

Hof bleibt.

Gleicher Satz.

Gleicher Satz.
`,
  )
  fs.writeFileSync(english, '---\nlayout: home\ntitle: Hof\n---\n\nHof bleibt.\n')
  const event = path.join(root, 'content', 'events', 'herbstfest.yml')
  fs.mkdirSync(path.dirname(event), { recursive: true })
  fs.writeFileSync(
    event,
    `slug: herbstfest
title:
  de: Herbstfest
  en: Herbstfest
body:
  de: |
    Ein Abend mit Herbstfest.

    Gleicher Satz.

    Gleicher Satz.
  en: |
    An evening.
place: rappachgasse
categories: []
dates:
  - start: '2030-06-01T18:00:00+02:00'
`,
  )
  const place = path.join(root, 'content', 'places', 'rappachgasse.yml')
  fs.mkdirSync(path.dirname(place), { recursive: true })
  fs.writeFileSync(
    place,
    `slug: rappachgasse
name:
  de: Rappachgasse
  en: Rappachgasse
address: Rappachgasse 1
onPremises: true
`,
  )
  fs.mkdirSync(path.join(root, 'design'), { recursive: true })
  fs.writeFileSync(path.join(root, 'design', 'nav.yml'), 'label: Hof\n')

  const title = applyContentCorrection(root, 'content/pages/home/de.md|title', 'Hof', 'Garten')
  assert.deepEqual(title, { file: 'content/pages/home/de.md', changed: true })
  const afterTitle = fs.readFileSync(page, 'utf8')
  assert.match(afterTitle, /title: Garten/)
  assert.match(afterTitle, /Hof bleibt\./)
  assert.match(afterTitle, /lede: A house\./)
  assert.match(fs.readFileSync(english, 'utf8'), /title: Hof/)

  const first = applyContentCorrection(root, 'content/pages/home/de.md|body|0', 'Hof', 'Haus')
  assert.equal('changed' in first && first.changed, true)
  const afterBody = fs.readFileSync(page, 'utf8')
  assert.match(afterBody, /title: Garten/)
  assert.match(afterBody, /Haus bleibt\./)
  assert.equal(afterBody.includes('Hof bleibt.'), false)

  const paragraph = applyContentCorrection(root, 'content/pages/home/de.md|body|1', 'Gleicher Satz', 'Erster Satz')
  assert.equal('changed' in paragraph && paragraph.changed, true)
  const afterParagraph = fs.readFileSync(page, 'utf8')
  assert.match(afterParagraph, /Erster Satz\./)
  assert.match(afterParagraph, /Gleicher Satz\./)

  const twice = applyContentCorrection(root, 'content/pages/note/de.md|body|0', 'Hof', 'Haus')
  fs.mkdirSync(path.join(root, 'content', 'pages', 'note'), { recursive: true })
  const note = path.join(root, 'content', 'pages', 'note', 'de.md')
  fs.writeFileSync(note, '---\nlayout: article\ntitle: Notiz\n---\n\nHof und Hof.\n')
  const refused = applyContentCorrection(root, 'content/pages/note/de.md|body|0', 'Hof', 'Haus')
  assert.deepEqual(refused, { error: TWICE })
  assert.match(fs.readFileSync(note, 'utf8'), /Hof und Hof\./)
  assert.deepEqual(twice, { error: HINT })

  const german = applyContentCorrection(root, 'content/events/herbstfest.yml|title.de', 'Herbstfest', 'Sommerfest')
  assert.deepEqual(german, { file: 'content/events/herbstfest.yml', changed: true })
  const eventDoc = readYaml<EventDoc>(event, { slug: '', title: {}, body: {}, place: '', categories: [], dates: [] })
  assert.equal(eventDoc.title.de, 'Sommerfest')
  assert.equal(eventDoc.title.en, 'Herbstfest')
  assert.match(eventDoc.body.de ?? '', /Ein Abend mit Herbstfest/)
  assert.match(fs.readFileSync(event, 'utf8'), /de: \|/)

  const block = applyContentCorrection(root, 'content/events/herbstfest.yml|body.de|1', 'Gleicher Satz', 'Erster Satz')
  assert.equal('changed' in block && block.changed, true)
  const body = readYaml<EventDoc>(event, { slug: '', title: {}, body: {}, place: '', categories: [], dates: [] }).body.de ?? ''
  assert.match(body, /Erster Satz/)
  assert.match(body, /Gleicher Satz/)
  assert.equal(body.indexOf('Erster Satz') < body.indexOf('Gleicher Satz'), true)

  const named = applyContentCorrection(root, 'content/places/rappachgasse.yml|name.de', 'Rappachgasse', 'Hofgasse')
  assert.deepEqual(named, { file: 'content/places/rappachgasse.yml', changed: true })
  const placeDoc = readYaml<PlaceDoc>(place, { slug: '', name: {}, onPremises: true })
  assert.equal(placeDoc.name.de, 'Hofgasse')
  assert.equal(placeDoc.name.en, 'Rappachgasse')
  assert.equal(placeDoc.address, 'Rappachgasse 1')
  assert.match(fs.readFileSync(page, 'utf8'), /Herbstfest im Hof|Haus bleibt|Garten/)

  const homepage = applyContentCorrection(root, 'content/events/herbstfest.yml|title.de', 'Sommerfest', 'Lichterfest')
  assert.equal('changed' in homepage && homepage.changed, true)
  assert.equal(readYaml<EventDoc>(event, { slug: '', title: {}, body: {}, place: '', categories: [], dates: [] }).title.de, 'Lichterfest')
  assert.match(fs.readFileSync(page, 'utf8'), /title: Garten/)

  const escaped = path.join(root, 'content', 'pages', 'kredit', 'de.md')
  fs.mkdirSync(path.dirname(escaped), { recursive: true })
  fs.writeFileSync(
    escaped,
    `---
layout: article
title: Direktkredite
---

**Lieber 1000 Freund\\*innen im Rücken**

Du kannst uns per Email an [direktkredit@schlor.org](mailto:direktkredit@schlor.org) schreiben.

*   Du kannst den Zinssatz frei wählen
*   Du kannst jederzeit vorbeischaun

**Wie werde ich als Anleger\\_in informiert?**
`,
  )
  const star = applyContentCorrection(root, 'content/pages/kredit/de.md|body|0', 'Freund*innen', 'Freundinnen')
  assert.equal('changed' in star && star.changed, true)
  const afterStar = fs.readFileSync(escaped, 'utf8')
  assert.match(afterStar, /\*\*Lieber 1000 Freundinnen im Rücken\*\*/)
  assert.equal(afterStar.includes('Freund\\*innen'), false)

  const mail = applyContentCorrection(root, 'content/pages/kredit/de.md|body|1', 'direktkredit@schlor.org', 'kredit@schlor.org')
  assert.equal('changed' in mail && mail.changed, true)
  const afterMail = fs.readFileSync(escaped, 'utf8')
  assert.match(afterMail, /\[kredit@schlor\.org\]\(mailto:direktkredit@schlor\.org\)/)

  const firstItem = applyContentCorrection(root, 'content/pages/kredit/de.md|body|2|0', 'Zinssatz', 'Zins')
  assert.equal('changed' in firstItem && firstItem.changed, true)
  const afterItem = fs.readFileSync(escaped, 'utf8')
  assert.match(afterItem, /Zins frei wählen/)
  assert.match(afterItem, /Du kannst jederzeit vorbeischaun/)
  const repeated = applyContentCorrection(root, 'content/pages/kredit/de.md|body|2|1', 'Du kannst', 'Man kann')
  assert.equal('changed' in repeated && repeated.changed, true)
  assert.match(fs.readFileSync(escaped, 'utf8'), /Du kannst den Zins frei wählen/)
  assert.match(fs.readFileSync(escaped, 'utf8'), /Man kann jederzeit vorbeischaun/)

  const investor = applyContentCorrection(root, 'content/pages/kredit/de.md|body|3', 'Anleger_in', 'Anlegerin')
  assert.equal('changed' in investor && investor.changed, true)
  assert.match(fs.readFileSync(escaped, 'utf8'), /Anlegerin/)
  assert.equal(fs.readFileSync(escaped, 'utf8').includes('Anleger\\_in'), false)

  const design = path.join(root, 'design', 'nav.yml')
  const beforeDesign = fs.readFileSync(design, 'utf8')
  assert.deepEqual(applyContentCorrection(root, 'design/nav.yml|label', 'Hof', 'Garten'), { error: HINT })
  assert.equal(fs.readFileSync(design, 'utf8'), beforeDesign)
  assert.deepEqual(applyContentCorrection(root, 'content/pages/home/de.md|body|0', 'fehlt', 'neu'), { error: NOT_IN })
})

test('preview html names the field and published html does not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hint-preview-'))
  initSite(root)
  fs.mkdirSync(path.join(root, 'content', 'pages', 'note'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'content', 'pages', 'note', 'de.md'),
    '---\nlayout: article\ntitle: Hof\n---\n\nGleicher Satz.\n\nGleicher Satz.\n',
  )
  fs.writeFileSync(
    path.join(root, 'content', 'pages', 'note', 'en.md'),
    '---\nlayout: article\ntitle: Court\n---\n\nSame sentence.\n',
  )
  fs.mkdirSync(path.join(root, 'content', 'events'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'content', 'events', 'herbstfest.yml'),
    `slug: herbstfest
title:
  de: Herbstfest
  en: Autumn party
body:
  de: Ein Abend.
  en: An evening.
place: rappachgasse
categories: []
dates:
  - start: '2030-06-01T18:00:00+02:00'
`,
  )
  fs.mkdirSync(path.join(root, 'content', 'places'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'content', 'places', 'rappachgasse.yml'),
    `slug: rappachgasse
name:
  de: Rappachgasse
  en: Rappachgasse
address: Rappachgasse 1
onPremises: true
`,
  )
  const home = path.join(root, 'content', 'pages', 'home', 'de.md')
  fs.appendFileSync(home, '\nHerbstfest im Hof.\n')

  const preview = generate(root)
  const note = fs.readFileSync(path.join(preview.outDir, 'note', 'index.html'), 'utf8')
  assert.match(note, /data-content="content\/pages\/note\/de\.md\|title"/)
  assert.match(note, /<title>Hof · /)
  assert.equal(/<title>[^<]*data-content/.test(note), false)
  assert.match(note, /data-content="content\/pages\/note\/de\.md\|body\|0"/)
  assert.match(note, /data-content="content\/pages\/note\/de\.md\|body\|1"/)
  assert.match(note, /Hof/)
  assert.equal(note.includes('\uE000'), false)

  const index = fs.readFileSync(path.join(preview.outDir, 'index.html'), 'utf8')
  assert.match(index, /data-content="content\/events\/herbstfest\.yml\|title\.de"/)
  assert.match(index, /Herbstfest/)
  assert.match(index, /data-content="content\/pages\/home\/de\.md\|body\|/)
  assert.equal(index.includes('\uE000'), false)

  const eventPage = fs.readFileSync(path.join(preview.outDir, 'events', 'herbstfest', 'index.html'), 'utf8')
  assert.match(eventPage, /data-content="content\/places\/rappachgasse\.yml\|name\.de"/)
  assert.match(eventPage, /Rappachgasse/)
  assert.match(eventPage, /2030-06-01T18:00:00\+02:00/)
  assert.equal(eventPage.includes('|dates'), false)

  const ics = fs.readFileSync(path.join(preview.outDir, 'kalender', 'housing.ics'), 'utf8')
  assert.equal(ics.includes('\uE000'), false)
  assert.equal(ics.includes('data-content'), false)

  const published = generate(root, path.join(root, 'published'))
  const publicHome = fs.readFileSync(path.join(published.outDir, 'index.html'), 'utf8')
  const publicEvent = fs.readFileSync(path.join(published.outDir, 'events', 'herbstfest', 'index.html'), 'utf8')
  assert.equal(publicHome.includes('data-content'), false)
  assert.equal(publicEvent.includes('data-content'), false)
  assert.equal(publicHome.includes('\uE000'), false)
  assert.match(publicHome, /Herbstfest/)
  assert.match(publicEvent, /Rappachgasse/)
})
