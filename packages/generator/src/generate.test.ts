import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  applyProposal,
  bilingualGaps,
  checkLayout,
  forkLayout,
  formatCatalog,
  generate,
  initSite,
  layoutCatalog,
  lostContent,
  slotExpectations,
  pagesByLayout,
  parseSlotSchema,
  readLabels,
  readLayout,
  readPage,
  renderContent,
  replaceLayout,
  validateSlots,
  writeLayout,
  writePage,
} from './index'
import { scopeLayoutCss } from './layouts'
import { contrastRatio, contrastWarnings, nearestColor, parseTokens, tokenSummary } from './tokens'

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

const LANGUAGES = [
  { id: 'de', label: 'Deutsch', optional: false },
  { id: 'en', label: 'English', optional: true },
]

function newSite(prefix = 'housing-site-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  initSite(root)
  return root
}

function writeNote(root: string) {
  writeLayout(path.join(root, 'design'), {
    name: 'note',
    purpose: 'A short note with a badge.',
    slots: { body: 'markdown', badge: { type: 'text', translate: false } },
    template: '{% extends "shell.njk" %}{% block body %}<p class="badge">{{ slots.badge }}</p><div>{{ slots.body }}</div>{% endblock %}\n',
  })
}

test('generate writes the default language, an optional translation, and ical', () => {
  const root = newSite()
  writePage(root, { slug: 'nur-deutsch', layout: 'article', title: { de: 'Nur Deutsch' }, slots: { body: { de: 'Ein Satz.' } } })
  const result = generate(root)
  assert.equal(bilingualGaps(root).length, 0)
  assert.equal(fs.existsSync(path.join(result.outDir, 'index.html')), true)
  assert.equal(fs.existsSync(path.join(result.outDir, 'en', 'index.html')), true)
  assert.equal(fs.existsSync(path.join(result.outDir, 'nur-deutsch', 'index.html')), true)
  assert.equal(fs.existsSync(path.join(result.outDir, 'en', 'nur-deutsch', 'index.html')), false)
  const home = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8')
  assert.match(home, /Wohnprojekt/)
  assert.match(home, /von den Menschen/)
  assert.match(home, /href="\/en\/"/)
  assert.match(home, /<body[^>]*data-layout="home"/)
  assert.match(fs.readFileSync(path.join(result.outDir, 'en', 'index.html'), 'utf8'), /people who live/)
  assert.match(fs.readFileSync(path.join(result.outDir, 'assets', 'styles.css'), 'utf8'), /#3f6f64|\.text-heading/)
  const ics = fs.readFileSync(path.join(result.outDir, 'kalender', 'housing.ics'), 'utf8')
  assert.match(ics, /PRODID:-\/\/Housing project\/\/website\/\/DE/)
  assert.equal(fs.existsSync(path.join(result.outDir, 'kalender', 'schlor.ics')), false)
  writePage(root, { slug: 'home', layout: 'home', title: { en: 'Only English' }, slots: {} })
  assert.equal(bilingualGaps(root).some((gap) => gap.includes('home') && gap.includes('title.de')), true)
})

test('a page is checked against the slots of its layout', () => {
  const schema = parseSlotSchema({
    body: { type: 'markdown', required: true },
    facts: { type: 'list', of: { label: 'text', value: { type: 'text', translate: false } } },
    photo: 'image',
  })
  const good = validateSlots(schema, { body: { de: 'Text' }, facts: [{ label: { de: 'Größe' }, value: '68 m²' }], photo: '/media/a.jpg' }, LANGUAGES)
  assert.deepEqual(good.errors, [])
  const bad = validateSlots(schema, { body: 'Text', facts: [{ label: 'Größe' }], photo: 'a.jpg', extra: 1 }, LANGUAGES)
  assert.ok(bad.errors.some((error) => /unknown slot extra\. This layout has: body, facts, photo/.test(error)))
  assert.ok(bad.errors.some((error) => /slots\.body must be an object with one text per language/.test(error)))
  assert.ok(bad.errors.some((error) => /slots\.facts\.0\.label must be an object/.test(error)))
  assert.ok(bad.errors.some((error) => /slots\.photo must be a picture address/.test(error)))
  const missing = validateSlots(schema, {}, LANGUAGES)
  assert.deepEqual(missing.errors, ['slots.body is required in every language that is not optional (de)'])
  assert.throws(() => parseSlotSchema({ title: 'text' }), /reserved/)
  assert.throws(() => parseSlotSchema({ a: 'bold' }), /unknown type bold/)
  assert.throws(() => parseSlotSchema({ a: { type: 'list' } }), /needs of/)
})

test('a layout the agent writes is checked, rendered, scoped and listed in the catalog', () => {
  const root = newSite('housing-layout-')
  const designDir = path.join(root, 'design')
  assert.throws(
    () => writeLayout(designDir, { name: 'bad', purpose: 'x', slots: { body: 'markdown' }, template: '{{ slots.body }}{{ slots.nope }}' }),
    /reads slots nope that layout\.yml does not declare/,
  )
  assert.throws(() => writeLayout(designDir, { name: 'bad', purpose: 'x', slots: {}, template: '{% if %}' }), /does not compile/)
  assert.throws(() => writeLayout(designDir, { name: 'bad', purpose: ' ', slots: {}, template: 'x' }), /needs a purpose/)
  assert.equal(fs.existsSync(path.join(designDir, 'layouts', 'bad')), false)
  const written = writeLayout(designDir, {
    name: 'note',
    purpose: 'A short note with a badge.',
    slots: { body: 'markdown', badge: { type: 'text', translate: false }, unused: 'text' },
    template: '{% extends "shell.njk" %}{% block body %}<p class="badge">{{ slots.badge }}</p>{{ slots.body }}{% endblock %}\n',
    style: '.badge { color: red; }\n@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }\n',
  })
  assert.deepEqual(written.warnings, ['slots unused are declared but template.njk never shows them'])
  writePage(root, { slug: 'notiz', layout: 'note', title: { de: 'Notiz' }, slots: { body: { de: 'Ein **Satz**.' }, badge: 'Neu' } })
  const result = generate(root)
  const page = fs.readFileSync(path.join(result.outDir, 'notiz', 'index.html'), 'utf8')
  assert.match(page, /<body[^>]*data-layout="note"/)
  assert.match(page, /<p class="badge">[^]*Neu/)
  assert.match(page, /<strong>Satz<\/strong>/)
  const css = fs.readFileSync(path.join(result.outDir, 'assets', 'styles.css'), 'utf8')
  assert.match(css, /body\[data-layout=["']note["']\][^{]*\.badge|\[data-layout=["']note["']\]/)
  assert.match(css, /@keyframes pulse/)
  const catalog = layoutCatalog(designDir, pagesByLayout(root))
  const note = catalog.find((entry) => entry.name === 'note')
  assert.deepEqual(note?.pages, ['notiz'])
  assert.equal(note?.signature, 'body:markdown, badge:text shared, unused:text')
  assert.equal(catalog.find((entry) => entry.name === 'calendar')?.signature, 'filled by the generator')
  assert.match(formatCatalog(catalog), /- note — A short note with a badge\.\n  slots: body:markdown, badge:text shared, unused:text\n  used by: notiz/)
  forkLayout(designDir, 'note', 'note-wide')
  assert.equal(readLayout(designDir, 'note-wide').purpose, 'A short note with a badge.')
  assert.throws(() => forkLayout(designDir, 'note', 'note-wide'), /exists/)
})

test('styles that cannot be nested stay outside the layout scope', () => {
  const scoped = scopeLayoutCss('room', '/* a { } */ .card { color: red; }\n@media (min-width: 40em) { .card { color: blue; } }\n@font-face { font-family: X; src: url("a{b.woff"); }\n@keyframes spin { to { opacity: 1 } }')
  assert.match(scoped, /^@font-face/)
  assert.match(scoped, /@keyframes spin \{ to \{ opacity: 1 \} \}/)
  assert.match(scoped, /body\[data-layout="room"\] \{\n\/\* a \{ \} \*\/ \.card \{ color: red; \}\n@media \(min-width: 40em\) \{ \.card \{ color: blue; \} \}\n\}/)
  assert.equal(scopeLayoutCss('room', ''), '')
})

test('labels are shown in the language of the page', () => {
  const root = newSite('housing-labels-')
  fs.writeFileSync(
    path.join(root, 'design', 'layouts', 'article', 'template.njk'),
    '{% extends "shell.njk" %}{% block body %}<p class="when">{{ labels.when }}</p>{{ slots.body }}{% endblock %}\n',
  )
  fs.writeFileSync(path.join(root, 'design', 'labels.yml'), 'when:\n  de: Wann?\n  en: When?\n')
  writePage(root, { slug: 'k', layout: 'article', title: { de: 'K', en: 'K' }, slots: { body: { de: 'x', en: 'y' } } })
  const result = generate(root)
  assert.match(fs.readFileSync(path.join(result.outDir, 'k', 'index.html'), 'utf8'), /Wann\?/)
  assert.match(fs.readFileSync(path.join(result.outDir, 'en', 'k', 'index.html'), 'utf8'), /When\?/)
})

test('replacing a layout moves every page onto the layout that remains', () => {
  const root = newSite('housing-replace-')
  writeNote(root)
  const kontakt = readPage(root, 'kontakt')!
  writePage(root, { ...kontakt, layout: 'note', slots: { body: kontakt.slots.body } })
  const updated = replaceLayout(root, 'note', 'article')
  assert.deepEqual(updated, ['kontakt'])
  assert.equal(fs.existsSync(path.join(root, 'design', 'layouts', 'note')), false)
  assert.equal(readPage(root, 'kontakt')?.layout, 'article')
  assert.throws(() => replaceLayout(root, 'event', 'article'))
  generate(root)
})

test('a shown event field is rendered and an unknown option is ignored', () => {
  const root = newSite('housing-fields-')
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
  assert.match(page, /Kommt vorbei/)
  assert.equal(page.includes('gone'), false)
  const ics = fs.readFileSync(path.join(result.outDir, 'kalender', 'housing.ics'), 'utf8')
  assert.match(ics, /BEGIN:VEVENT/)
})

test('an accepted proposal writes a layout, labels, and the first page', () => {
  const root = newSite('housing-setup-')
  const notes = applyProposal(
    root,
    {
      layouts: [
        {
          name: 'note',
          purpose: 'A note.',
          slots: { body: 'markdown' },
          template: '{% extends "shell.njk" %}{% block body %}{{ slots.body }}<small>{{ labels.thanks }}</small>{% endblock %}',
        },
      ],
      labels: { thanks: { de: 'Danke', en: 'Thanks' } },
      pages: [{ slug: 'notiz', layout: 'note', title: { de: 'Notiz' }, slots: { body: { de: 'Ein Satz.' } } }],
      site: { timezone: 'Europe/Berlin' },
    },
    true,
  )
  assert.match(notes, /layout note/)
  assert.match(notes, /setup accepted/)
  assert.match(fs.readFileSync(path.join(root, 'design', 'layouts', 'note', 'layout.yml'), 'utf8'), /purpose: A note\./)
  assert.match(fs.readFileSync(path.join(root, 'design', 'site.yml'), 'utf8'), /Europe\/Berlin/)
  assert.match(fs.readFileSync(path.join(root, 'design', 'setup.yml'), 'utf8'), /accepted: true/)
  const result = generate(root)
  const page = fs.readFileSync(path.join(result.outDir, 'notiz', 'index.html'), 'utf8')
  assert.match(page, /Ein Satz/)
  assert.match(page, /Danke/)
  assert.throws(
    () => applyProposal(root, { pages: [{ slug: 'falsch', layout: 'note', title: { de: 'F' }, slots: { body: 'Text' } }] }),
    /slots\.body must be an object/,
  )
})

test('a page shows its inline-edit hints in the preview only', () => {
  const root = newSite('housing-hints-')
  writeNote(root)
  writePage(root, { slug: 'direktkredite', layout: 'note', title: { de: 'Direktkredite' }, slots: { body: { de: 'Hallo' }, badge: 'SchloR unterstützen' } })
  const preview = generate(root)
  const page = fs.readFileSync(path.join(preview.outDir, 'direktkredite', 'index.html'), 'utf8')
  assert.match(page, /data-content="content\/pages\/direktkredite\.yml\|slots\.badge"/)
  assert.match(page, /data-content="content\/pages\/direktkredite\.yml\|slots\.body\.de\|0"/)
  const kontakt = fs.readFileSync(path.join(preview.outDir, 'kontakt', 'index.html'), 'utf8')
  assert.match(kontakt, /data-content="content\/pages\/kontakt\.yml\|title\.de"/)
  assert.match(page, /SchloR unterstützen/)
  const published = generate(root, path.join(root, 'out'))
  assert.equal(fs.readFileSync(path.join(published.outDir, 'direktkredite', 'index.html'), 'utf8').includes('data-content'), false)
})

test('a layout edit that breaks a template is reported by the checker', () => {
  const root = newSite('housing-check-')
  const def = readLayout(path.join(root, 'design'), 'home')
  assert.deepEqual(checkLayout(def, fs.readFileSync(path.join(root, 'design', 'layouts', 'home', 'template.njk'), 'utf8')).errors, [])
  assert.match(checkLayout(def, '{{ slots.missing }}').errors.join(), /missing/)
})

test('words a layout stops showing are reported after a design change', () => {
  const root = newSite('housing-lost-')
  writeLayout(path.join(root, 'design'), {
    name: 'facts',
    purpose: 'A page with a lede and facts.',
    slots: { lede: 'text', body: 'markdown' },
    template: '{% extends "shell.njk" %}{% block body %}<p>{{ slots.lede }}</p>{{ slots.body }}{% endblock %}',
  })
  writePage(root, {
    slug: 'raum',
    layout: 'facts',
    title: { de: 'Raum', en: 'Room' },
    slots: { lede: { de: 'Hell & freundlich.', en: 'Bright.' }, body: { de: 'Ein **großer** Raum.', en: 'A big room.' } },
  })
  generate(root)
  assert.deepEqual(lostContent(root), [])
  writeLayout(path.join(root, 'design'), {
    name: 'facts',
    purpose: 'A page with a lede and facts.',
    slots: { lede: 'text', body: 'markdown' },
    template: '{% extends "shell.njk" %}{% block body %}<p>{{ slots.lede }}</p>{% endblock %}',
  })
  generate(root)
  assert.deepEqual(lostContent(root), ['raum (de): slots.body', 'raum (en): slots.body'])
})

test('a link or emphasis inside a sentence does not split it', () => {
  const root = newSite('housing-inline-')
  writePage(root, { slug: 'k', layout: 'article', title: { de: 'K' }, slots: { body: { de: 'Schreib an **uns**: [info@example.org](mailto:info@example.org).' } } })
  generate(root)
  assert.deepEqual(lostContent(root), [])
  assert.equal(slotExpectations(root).find((page) => page.slug === 'k')?.texts[0].expected, 'Schreib an uns: info@example.org.')
})

test('tokens become the theme, and a bad token says what is wrong', () => {
  const root = newSite('housing-tokens-')
  fs.writeFileSync(path.join(root, 'design', 'tokens.yml'), 'colors:\n  primary: "#112233"\n  on-primary: "#ffeedd"\nfonts:\n  serif: \'"Fraunces", serif\'\nradius:\n  card: 12px\nwidths:\n  content: 60rem\n')
  fs.writeFileSync(
    path.join(root, 'design', 'layouts', 'article', 'template.njk'),
    '{% extends "shell.njk" %}{% block body %}<div class="bg-primary text-on-primary rounded-card max-w-content font-serif">{{ slots.body }}</div>{% endblock %}',
  )
  const out = generate(root)
  const css = fs.readFileSync(path.join(out.outDir, 'assets', 'styles.css'), 'utf8')
  assert.match(css, /--color-primary:\s*#112233/)
  assert.match(css, /\.bg-primary\s*\{[^}]*background-color:\s*var\(--color-primary\)/)
  assert.match(css, /\.text-on-primary\s*\{[^}]*color:\s*var\(--color-on-primary\)/)
  assert.match(css, /\.rounded-card\s*\{[^}]*border-radius:\s*var\(--radius-card\)/)
  assert.match(css, /\.max-w-content\s*\{[^}]*max-width:\s*var\(--container-content\)/)
  assert.match(css, /\.font-serif\s*\{[^}]*font-family:\s*var\(--font-serif\)/)
  assert.deepEqual(parseTokens('colors:\n  page: "#fff"\n').colors, { page: '#fff' })
  assert.throws(() => parseTokens('colors:\n  Page: "#fff"\n'), /colors\.Page must be lowercase words/)
  assert.throws(() => parseTokens('colors:\n  page: white\n'), /colors\.page must be a hex color such as #3f6f64, not white/)
  assert.throws(() => parseTokens('radius:\n  card: round\n'), /radius\.card must be a length/)
  assert.throws(() => parseTokens('shadows:\n  a: 1\n'), /unknown group shadows/)
  assert.throws(() => parseTokens('colors: [a'), /not valid YAML/)
  assert.deepEqual(parseTokens('').colors, {})
})

test('token colors that cannot be read are named, and the nearest token is found', () => {
  const tokens = parseTokens('colors:\n  ink: "#1c1917"\n  page: "#ffffff"\n  surface: "#e7e1d5"\n  on-primary: "#ffffff"\n  primary: "#7fb3a6"\n')
  assert.deepEqual(contrastWarnings(tokens), ['on-primary (#ffffff) on primary (#7fb3a6) has contrast 2.4:1 and needs 4.5:1.'])
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
  assert.deepEqual(nearestColor(tokens, '#E7E1D5'), { name: 'surface', value: '#e7e1d5', exact: true })
  assert.deepEqual(nearestColor(tokens, '#e8e0d0'), { name: 'surface', value: '#e7e1d5', exact: false })
  assert.deepEqual(nearestColor(tokens, '#fff'), { name: 'page', value: '#ffffff', exact: true })
  assert.equal(nearestColor(tokens, 'tomato'), null)
  assert.match(tokenSummary(tokens), /^Colors: ink #1c1917, page #ffffff/)
})

test('a setup proposal may carry tokens, and a bad token stops it', () => {
  const root = newSite('housing-setup-tokens-')
  const notes = applyProposal(root, { tokens: { colors: { primary: '#112233', 'on-primary': '#ffffff' }, widths: { content: '70rem' } } })
  assert.match(notes, /tokens/)
  assert.equal(parseTokens(fs.readFileSync(path.join(root, 'design', 'tokens.yml'), 'utf8')).colors.primary, '#112233')
  assert.throws(() => applyProposal(root, { tokens: { colors: { primary: 'teal' } } }), /colors\.primary must be a hex color/)
  assert.equal(parseTokens(fs.readFileSync(path.join(root, 'design', 'tokens.yml'), 'utf8')).colors.primary, '#112233')
})

test('a part of a proposal sent as the text of a file is read as data, and text that is not data is refused', () => {
  const root = newSite('housing-setup-text-')
  const notes = applyProposal(root, {
    labels: 'read_more:\n  de: Weiterlesen\n  en: Read more\n' as never,
    nav: 'menu:\n  - href: /kontakt/\n    label:\n      de: Kontakt\n      en: Contact\n' as never,
    tokens: 'colors:\n  primary: "#112233"\n  on-primary: "#ffffff"\n' as never,
    layouts: [{ name: 'note', purpose: 'A note.', slots: { body: 'markdown' }, template: '{% extends "shell.njk" %}{% block body %}{{ slots.body }}<a>{{ labels.read_more }}{{ labels.missing_one }}</a>{% endblock %}' }],
  })
  assert.match(notes, /labels used by templates but not in design\/labels\.yml, so they show nothing: missing_one/)
  const labels = fs.readFileSync(path.join(root, 'design', 'labels.yml'), 'utf8')
  assert.match(labels, /read_more:\n {2}de: Weiterlesen/)
  assert.match(labels, /news:\n {2}de: Aktuelles/)
  assert.equal(/^"?\d+"?:/m.test(labels), false)
  assert.deepEqual(readLabels(root, 'en').read_more, 'Read more')
  assert.match(fs.readFileSync(path.join(root, 'design', 'nav.yml'), 'utf8'), /menu:\n {2}- href: \/kontakt\//)
  assert.throws(() => applyProposal(root, { labels: 'a: [' as never }), /labels is not valid YAML/)
  assert.throws(() => applyProposal(root, { labels: 'just some words' as never }), /labels must be an object/)
  assert.throws(() => applyProposal(root, { labels: { 'Read More': { de: 'x' } } as never }), /Label name Read More must be lowercase words/)
  assert.throws(() => applyProposal(root, { labels: { more: 'Mehr' } as never }), /Label more must be an object with one text per language/)
  assert.throws(() => applyProposal(root, { nav: 'plain text' as never }), /nav must be a list or an object, not text/)
  assert.throws(() => applyProposal(root, { pages: 'x' as never }), /pages must be a list/)
  assert.throws(() => applyProposal(root, { site: 'x' as never }), /site must be an object/)
})
