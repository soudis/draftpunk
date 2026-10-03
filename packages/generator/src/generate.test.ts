import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyProposal, bilingualGaps, generate, initSite, readPageFile, renderContent, replaceLayout, writePageFile } from './index'

test('the picture catalog stays out of the published site', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-site-'))
  initSite(root)
  fs.mkdirSync(path.join(root, 'media'), { recursive: true })
  fs.writeFileSync(path.join(root, 'media', 'pictures.yml'), 'file: secret\n')
  fs.writeFileSync(path.join(root, 'media', 'hof.jpg'), 'picture')
  const result = generate(root)
  assert.equal(fs.existsSync(path.join(result.outDir, 'media', 'pictures.yml')), false)
  assert.equal(fs.existsSync(path.join(result.outDir, 'media', 'hof.jpg')), true)
})

test('structural html stays and presentation is removed', () => {
  const html = renderContent('Hello <span style="color:red" class="text-coral">welt</span><script>alert(1)</script>\n\n| a | b |\n| - | - |\n| 1 | 2 |')
  assert.equal(html.includes('style'), false)
  assert.equal(html.includes('class'), false)
  assert.equal(html.includes('script'), false)
  assert.match(html, /<table>/)
  assert.match(html, /welt/)
})

test('generate writes the default language, an optional translation, and ical', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-site-'))
  initSite(root)
  fs.mkdirSync(path.join(root, 'content', 'pages', 'nur-deutsch'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'content', 'pages', 'nur-deutsch', 'de.md'),
    '---\nlayout: article\ntitle: Nur Deutsch\n---\nEin Satz.\n',
  )
  const result = generate(root)
  assert.equal(bilingualGaps(root).length, 0)
  assert.equal(fs.existsSync(path.join(result.outDir, 'index.html')), true)
  assert.equal(fs.existsSync(path.join(result.outDir, 'en', 'index.html')), true)
  const home = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8')
  assert.match(home, /Housing project/)
  assert.match(home, /people who live/)
  assert.match(home, /href="\/en\/"/)
  assert.match(fs.readFileSync(path.join(result.outDir, 'assets', 'styles.css'), 'utf8'), /#3f6f64|\.text-teal/)
  const ics = fs.readFileSync(path.join(result.outDir, 'kalender', 'housing.ics'), 'utf8')
  assert.match(ics, /PRODID:-\/\/Housing project\/\/website\/\/DE/)
  assert.equal(fs.existsSync(path.join(result.outDir, 'kalender', 'schlor.ics')), false)
  fs.writeFileSync(path.join(root, 'content', 'pages', 'home', 'de.md'), '---\nlayout: home\ntitle: Leer\n---\n\n')
  assert.equal(bilingualGaps(root).some((gap) => gap.includes('home de')), true)
})

test('writing a page keeps its photos and groups', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-fields-'))
  initSite(root)
  const file = path.join(root, 'content', 'pages', 'wohnen', 'de.md')
  writePageFile(file, {
    layout: 'room',
    title: 'Wohnen',
    body: 'Text',
    data: { images: [{ src: '/media/a.jpg', caption: 'Hof' }], email: 'wohn@schlor.org' },
  })
  writePageFile(file, { layout: 'room', title: 'Wohnen', body: 'Neuer Text', data: readPageFile(file, 'wohnen', 'de').data })
  const saved = readPageFile(file, 'wohnen', 'de')
  assert.equal(saved.body.trim(), 'Neuer Text')
  assert.equal((saved.data.images as { src: string }[])[0].src, '/media/a.jpg')
  assert.equal(saved.data.email, 'wohn@schlor.org')
})

test('replacing a layout moves every page onto the layout that remains', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-layout-'))
  initSite(root)
  fs.writeFileSync(path.join(root, 'design', 'layouts', 'note.yml'), 'sections:\n  - shape: prose\n')
  const de = path.join(root, 'content', 'pages', 'kontakt', 'de.md')
  fs.writeFileSync(de, fs.readFileSync(de, 'utf8').replace('layout: article', 'layout: note'))
  const en = path.join(root, 'content', 'pages', 'kontakt', 'en.md')
  fs.writeFileSync(en, fs.readFileSync(en, 'utf8').replace('layout: article', 'layout: note'))
  const updated = replaceLayout(root, 'note', 'article')
  assert.deepEqual(updated, ['kontakt'])
  assert.equal(fs.existsSync(path.join(root, 'design', 'layouts', 'note.yml')), false)
  assert.match(fs.readFileSync(de, 'utf8'), /layout: article/)
  assert.throws(() => replaceLayout(root, 'event', 'article'))
  generate(root)
})

test('an existing nunjucks layout wins over a section list', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-njk-'))
  initSite(root)
  fs.writeFileSync(
    path.join(root, 'design', 'layouts', 'article.njk'),
    '{% extends "shell.njk" %}{% block body %}<p class="from-template">{{ title }}</p>{% endblock %}\n',
  )
  const result = generate(root)
  const page = fs.readFileSync(path.join(result.outDir, 'kontakt', 'index.html'), 'utf8')
  assert.match(page, /from-template/)
})

test('a shown event field is rendered and an unknown option is ignored', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-fields-'))
  initSite(root)
  fs.mkdirSync(path.join(root, 'content', 'places'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'content', 'places', 'haus.yml'),
    'slug: haus\nname:\n  de: Haus\n  en: House\nonPremises: true\n',
  )
  fs.writeFileSync(
    path.join(root, 'design', 'fields.yml'),
    [
      '- id: audience',
      '  show: true',
      '  label:',
      '    de: Publikum',
      '    en: Audience',
      '  options:',
      '    - id: public',
      '      label:',
      '        de: Öffentlich',
      '        en: Public',
    ].join('\n'),
  )
  fs.mkdirSync(path.join(root, 'content', 'events'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'content', 'events', 'treffen.yml'),
    [
      'slug: treffen',
      'title:',
      '  de: Treffen',
      '  en: Meeting',
      'body:',
      '  de: Kommt vorbei.',
      '  en: Come by.',
      'place: haus',
      'categories: []',
      'fields:',
      '  audience: public',
      '  missing: gone',
      'dates:',
      '  - start: 2030-01-02T18:00:00.000Z',
    ].join('\n'),
  )
  const result = generate(root)
  const page = fs.readFileSync(path.join(result.outDir, 'events', 'treffen', 'index.html'), 'utf8')
  assert.match(page, /Publikum/)
  assert.match(page, /Öffentlich/)
  assert.equal(page.includes('gone'), false)
  const ics = fs.readFileSync(path.join(result.outDir, 'kalender', 'housing.ics'), 'utf8')
  assert.match(ics, /BEGIN:VEVENT/)
})

test('an accepted proposal writes a layout and the first page', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-setup-'))
  initSite(root)
  const notes = applyProposal(
    root,
    {
      layouts: [{ name: 'note', sections: [{ shape: 'prose' }] }],
      pages: [{ slug: 'notiz', lang: 'de', title: 'Notiz', layout: 'note', body: 'Ein Satz.' }],
      site: { timezone: 'Europe/Berlin' },
    },
    true,
  )
  assert.match(notes, /layout note/)
  assert.match(notes, /setup accepted/)
  assert.match(fs.readFileSync(path.join(root, 'design', 'layouts', 'note.yml'), 'utf8'), /prose/)
  assert.match(fs.readFileSync(path.join(root, 'design', 'site.yml'), 'utf8'), /Europe\/Berlin/)
  assert.match(fs.readFileSync(path.join(root, 'design', 'setup.yml'), 'utf8'), /accepted: true/)
  const result = generate(root)
  assert.match(fs.readFileSync(path.join(result.outDir, 'notiz', 'index.html'), 'utf8'), /Ein Satz/)
})

test('a private layout reads a slot from the page', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-slot-'))
  initSite(root)
  fs.writeFileSync(
    path.join(root, 'design', 'layouts', 'kredit.njk'),
    '{% extends "shell.njk" %}\n{% block body %}<p>{{ slots.badge }}</p>{% endblock %}\n',
  )
  writePageFile(path.join(root, 'content', 'pages', 'direktkredite', 'de.md'), {
    layout: 'kredit',
    title: 'Direktkredite',
    body: '',
    data: { badge: 'SchloR unterstützen' },
  })
  const result = generate(root)
  const page = fs.readFileSync(path.join(result.outDir, 'direktkredite', 'index.html'), 'utf8')
  assert.match(page, /data-content="content\/pages\/direktkredite\/de\.md\|slots\.badge"/)
  assert.match(page, /SchloR unterstützen/)
})
