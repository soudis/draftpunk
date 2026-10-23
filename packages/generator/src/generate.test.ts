import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assetProblems,
  proposalProblems,
  readProposal,
  recordProposal,
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
  readSiteConfig,
  renderContent,
  replaceLayout,
  validateSlots,
  writeLayout,
  writePage,
} from './index'
import { scopeLayoutCss } from './layouts'
import { hasTransparency } from './baseline'
import { searchIndexJson, searchText, textLimit } from './search'
import { fontFaceCss, fontPreloadLinks, parseFonts, readFonts } from './fonts'
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

test('pictures load as the page needs them, keep their space, and a design that set an attribute keeps it', () => {
  const root = newSite('housing-pictures-')
  fs.writeFileSync(path.join(root, 'media', 'wide.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"/>')
  fs.writeFileSync(
    path.join(root, 'design', 'layouts', 'article', 'template.njk'),
    '{% extends "shell.njk" %}{% block body %}<img id="a" src="/media/wide.svg" alt=""><img id="b" src="/media/wide.svg" alt=""><img id="c" src="/media/wide.svg" alt="" loading="eager" width="10" height="5"><img id="d" src="/media/missing.png" alt="">{% endblock %}',
  )
  writePage(root, { slug: 'k', layout: 'article', title: { de: 'K' }, slots: { body: { de: 'x' } } })
  const out = generate(root, path.join(root, 'out'))
  const html = fs.readFileSync(path.join(out.outDir, 'k', 'index.html'), 'utf8')
  const tag = (id: string) => new RegExp(`<img id="${id}"[^>]*>`).exec(html)?.[0] ?? ''
  assert.equal(tag('a').includes('loading'), false)
  assert.match(tag('a'), /decoding="async" width="400" height="200"/)
  assert.match(tag('b'), /loading="lazy" decoding="async" width="400" height="200"/)
  assert.match(tag('c'), /loading="eager" width="10" height="5" decoding="async"/)
  assert.match(tag('d'), /loading="lazy" decoding="async">/)
  assert.equal(tag('d').includes('width'), false)
})

test('a page tells search engines and shared links what it is, and keeps what the design wrote', () => {
  const root = newSite('housing-head-')
  fs.writeFileSync(path.join(root, 'design', 'site.yml'), `${fs.readFileSync(path.join(root, 'design', 'site.yml'), 'utf8')}url: https://example.org/\n`)
  writePage(root, { slug: 'k', layout: 'article', title: { de: 'Kontakt "Hof"', en: 'Contact' }, slots: { body: { de: `${'Wir sind erreichbar. '.repeat(20)}`, en: 'Write to us.' } } })
  const out = generate(root, path.join(root, 'out'))
  const de = fs.readFileSync(path.join(out.outDir, 'k', 'index.html'), 'utf8')
  assert.match(de, /<meta name="description" content="Wir sind erreichbar\. Wir sind erreichbar\.[^"]*…">/)
  assert.match(de, /<meta property="og:title" content="Kontakt &quot;Hof&quot;">/)
  assert.match(de, /<meta property="og:locale" content="de_AT">/)
  assert.match(de, /<link rel="canonical" href="https:\/\/example\.org\/k\/">/)
  assert.match(de, /<meta name="theme-color" content="#3f6f64">/)
  assert.match(fs.readFileSync(path.join(out.outDir, 'en', 'k', 'index.html'), 'utf8'), /<link rel="canonical" href="https:\/\/example\.org\/en\/k\/">/)
  assert.match(fs.readFileSync(path.join(out.outDir, 'en', 'k', 'index.html'), 'utf8'), /<meta name="description" content="Write to us\.">/)
  fs.writeFileSync(
    path.join(root, 'design', 'layouts', 'article', 'template.njk'),
    '{% extends "shell.njk" %}{% block body %}<p>x</p>{% endblock %}',
  )
  fs.writeFileSync(path.join(root, 'design', 'shell.njk'), fs.readFileSync(path.join(root, 'design', 'shell.njk'), 'utf8').replace('</head>', '<meta name="description" content="Mine"><link rel="canonical" href="https://mine.example/"></head>'))
  const mine = fs.readFileSync(path.join(generate(root, path.join(root, 'out2')).outDir, 'k', 'index.html'), 'utf8')
  assert.equal((mine.match(/name="description"/g) ?? []).length, 1)
  assert.match(mine, /content="Mine"/)
  assert.equal((mine.match(/rel="canonical"/g) ?? []).length, 1)
})

test('sitemap, robots, and a not-found page are made, and the sitemap waits for an address', () => {
  const root = newSite('housing-files-')
  const without = generate(root, path.join(root, 'a'))
  assert.equal(fs.existsSync(path.join(without.outDir, 'sitemap.xml')), false)
  assert.equal(fs.readFileSync(path.join(without.outDir, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\n')
  const notFound = fs.readFileSync(path.join(without.outDir, '404.html'), 'utf8')
  assert.match(notFound, /<title>Seite nicht gefunden · Housing project<\/title>/)
  assert.match(notFound, /<body[^>]*data-layout="notfound"/)
  assert.match(notFound, /Zur Startseite/)
  fs.writeFileSync(path.join(root, 'design', 'site.yml'), `${fs.readFileSync(path.join(root, 'design', 'site.yml'), 'utf8')}url: https://example.org\n`)
  const withUrl = generate(root, path.join(root, 'b'))
  const sitemap = fs.readFileSync(path.join(withUrl.outDir, 'sitemap.xml'), 'utf8')
  assert.match(sitemap, /<url><loc>https:\/\/example\.org\/<\/loc><\/url>/)
  assert.match(sitemap, /<url><loc>https:\/\/example\.org\/en\/kontakt\/<\/loc><\/url>/)
  assert.equal(sitemap.includes('404'), false)
  assert.match(fs.readFileSync(path.join(withUrl.outDir, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/example\.org\/sitemap\.xml/)
})

test('fonts are files in the site: face rules, preload, and a font from elsewhere is refused', () => {
  const faces = parseFonts('- family: Lora\n  weight: 400\n  file: /media/fonts/lora-latin-400-normal.woff2\n  unicodeRange: U+0000-00FF\n  preload: true\n- family: Lora\n  weight: 700\n  style: italic\n  file: /media/fonts/lora-latin-700-italic.woff2\n')
  assert.equal(fontFaceCss(faces), '@font-face {\n  font-family: "Lora";\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url("/media/fonts/lora-latin-400-normal.woff2") format("woff2");\n  unicode-range: U+0000-00FF;\n}\n@font-face {\n  font-family: "Lora";\n  font-style: italic;\n  font-weight: 700;\n  font-display: swap;\n  src: url("/media/fonts/lora-latin-700-italic.woff2") format("woff2");\n}')
  assert.deepEqual(fontPreloadLinks(faces), ['<link rel="preload" href="/media/fonts/lora-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>'])
  assert.throws(() => parseFonts('- family: X\n  file: https://fonts.gstatic.com/x.woff2\n'), /A font from another host is not allowed/)
  assert.throws(() => parseFonts('- family: X\n  file: /media/fonts/x.ttf\n'), /must be a woff2 file/)
  assert.throws(() => parseFonts('- family: X\n  weight: 1000\n  file: /media/fonts/x.woff2\n'), /weight must be 100 to 900/)
  assert.throws(() => parseFonts('family: X'), /must be a list of font faces/)
  const root = newSite('housing-fonts-')
  const out = generate(root, path.join(root, 'out'))
  const css = fs.readFileSync(path.join(out.outDir, 'assets', 'styles.css'), 'utf8')
  assert.equal((css.match(/@font-face/g) ?? []).length, 4)
  assert.match(css, /@view-transition/)
  assert.equal(/googleapis|gstatic|url\(\s*["']?(?:https?:)?\/\//.test(css), false)
  for (const face of readFonts(root)) assert.equal(fs.existsSync(path.join(out.outDir, face.file)), true, face.file)
  const html = fs.readFileSync(path.join(out.outDir, 'index.html'), 'utf8')
  assert.equal((html.match(/rel="preload"/g) ?? []).length, 2)
  assert.equal(/googleapis|gstatic/.test(html), false)
})

test('the published address comes from the deployment, and site.yml may override it', () => {
  const root = newSite('housing-url-')
  const before = process.env.SITE_URL
  try {
    delete process.env.SITE_URL
    assert.equal(readSiteConfig(root).url, undefined)
    process.env.SITE_URL = 'https://deploy.example.org/'
    assert.equal(readSiteConfig(root).url, 'https://deploy.example.org')
    const out = generate(root, path.join(root, 'a'))
    assert.match(fs.readFileSync(path.join(out.outDir, 'sitemap.xml'), 'utf8'), /<loc>https:\/\/deploy\.example\.org\/kontakt\/<\/loc>/)
    fs.writeFileSync(path.join(root, 'design', 'site.yml'), `${fs.readFileSync(path.join(root, 'design', 'site.yml'), 'utf8')}url: https://own.example.org\n`)
    assert.equal(readSiteConfig(root).url, 'https://own.example.org')
    process.env.SITE_URL = 'not an address'
    fs.writeFileSync(path.join(root, 'design', 'site.yml'), fs.readFileSync(path.join(root, 'design', 'site.yml'), 'utf8').replace('url: https://own.example.org\n', ''))
    assert.equal(readSiteConfig(root).url, undefined)
  } finally {
    if (before === undefined) delete process.env.SITE_URL
    else process.env.SITE_URL = before
  }
})

test('a proposal whose pages use generated layouts is refused whole, with every problem listed, and writes nothing', () => {
  const root = newSite('housing-proposal-')
  const before = fs.readFileSync(path.join(root, 'design', 'tokens.yml'), 'utf8')
  const bad = {
    tokens: { colors: { primary: '#112233', 'on-primary': '#ffffff' } },
    pages: [
      { slug: 'aktuelles', layout: 'archive', title: { de: 'Aktuelles' }, slots: {} },
      { slug: 'termine', layout: 'calendar', title: { de: 'Termine' }, slots: {} },
      { slug: 'ueber-uns', layout: 'article', title: { de: 'Über uns' }, slots: { body: { de: 'Text' } } },
    ],
  }
  const problems = recordProposal(root, bad)
  assert.equal(problems.length, 2)
  assert.match(problems[0], /Page aktuelles uses the layout archive/)
  assert.match(problems[0], /\/kalender\/.*\/blog\//)
  assert.match(problems[1], /Page termine uses the layout calendar/)
  assert.match(problems[1], /Use one of: .*article/)
  assert.throws(() => applyProposal(root, bad), /2 things stop this proposal[\s\S]*aktuelles[\s\S]*termine/)
  assert.equal(fs.readFileSync(path.join(root, 'design', 'tokens.yml'), 'utf8'), before)
  assert.equal(fs.existsSync(path.join(root, 'content', 'pages', 'ueber-uns.yml')), false)
})

test('a proposal that only fails when it is applied is refused before anything is written', () => {
  const root = newSite('housing-proposal-')
  const before = fs.readFileSync(path.join(root, 'design', 'tokens.yml'), 'utf8')
  const bad = {
    tokens: { colors: { primary: '#112233', 'on-primary': '#ffffff' } },
    pages: [{ slug: 'ueber-uns', layout: 'article', title: { de: 'Über uns' }, slots: { body: { not: 'text' } } }],
  }
  assert.equal(proposalProblems(root, bad).length, 1)
  assert.throws(() => applyProposal(root, bad), /slots\.body/)
  assert.equal(fs.readFileSync(path.join(root, 'design', 'tokens.yml'), 'utf8'), before)
  assert.deepEqual(recordProposal(root, { pages: [{ slug: 'ueber-uns', layout: 'article', title: { de: 'Über uns' }, slots: { body: { de: 'Text' } } }] }), [])
})

test('a setup that narrows the site to one language takes the other language out of the starter pages, so publishing is not blocked', () => {
  const root = newSite('housing-german-only-')
  assert.equal(bilingualGaps(root).length, 0)
  const notes = applyProposal(root, { site: { name: 'Haus', languages: [{ id: 'de', label: 'Deutsch' }] } }, true)
  assert.match(notes, /removed the texts of languages the site does not have from \d+ pages/)
  assert.deepEqual(bilingualGaps(root), [])
  const privacy = readPage(root, 'datenschutz')
  assert.deepEqual(Object.keys(privacy?.title ?? {}), ['de'])
  assert.deepEqual(Object.keys((privacy?.slots.body as Record<string, string>) ?? {}), ['de'])
  assert.equal(privacy?.slots.body && (privacy.slots.body as Record<string, string>).de.length > 10, true)
})

test('texts are left alone when the languages are not narrowed', () => {
  const root = newSite('housing-both-languages-')
  const before = JSON.stringify(readPage(root, 'datenschutz'))
  const notes = applyProposal(root, { site: { name: 'Haus', languages: [{ id: 'de' }, { id: 'en' }] } })
  assert.equal(notes.includes('removed the texts'), false)
  assert.equal(JSON.stringify(readPage(root, 'datenschutz')), before)
})

test('a proposal may give layouts and pages as one object, or as an object with an entry per name', () => {
  const root = newSite('housing-lists-')
  const layout = { purpose: 'Ein Text.', slots: { body: 'markdown' }, template: '{% extends "shell.njk" %}{% block body %}<main>{{ slots.body }}</main>{% endblock %}' }
  const one = recordProposal(root, { layouts: { name: 'text', ...layout } as never })
  assert.deepEqual(one, [])
  const many = recordProposal(root, {
    layouts: { text: layout, zwei: layout } as never,
    pages: { 'ueber-uns': { layout: 'text', title: { de: 'Über uns' }, slots: { body: { de: 'Text' } } } } as never,
  })
  assert.deepEqual(many, [])
  const recorded = readProposal(root)
  assert.deepEqual((recorded.layouts ?? []).map((item) => item.name), ['text', 'zwei'])
  assert.deepEqual((recorded.pages ?? []).map((item) => item.slug), ['ueber-uns'])
  assert.throws(() => recordProposal(root, { layouts: 'nonsense: [' as never }), /layouts/)
})

test('a site picture is shown by the starter header, reaches styles as a property, and its favicon and share picture reach every head', () => {
  const root = newSite('housing-assets-')
  fs.writeFileSync(path.join(root, 'media', 'logo.png'), 'png')
  fs.writeFileSync(path.join(root, 'media', 'icon.png'), 'png')
  fs.writeFileSync(path.join(root, 'media', 'share.jpg'), 'jpg')
  const before = generate(root)
  assert.equal(fs.readFileSync(path.join(before.outDir, 'index.html'), 'utf8').includes('logo.png'), false)
  const file = path.join(root, 'design', 'site.yml')
  const site = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, `${site}\nurl: https://haus.example\nassets:\n  logo: /media/logo.png\n  favicon: /media/icon.png\n  social: /media/share.jpg\n  muster: /media/logo.png\n  bad name: /media/logo.png\n  outside: https://elsewhere.example/x.png\n`)
  const result = generate(root)
  const home = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8')
  assert.match(home, /<img[^>]+src="\/media\/logo\.png"[^>]+alt="[^"]+"/)
  assert.match(home, /<link rel="icon" href="\/media\/icon\.png">/)
  assert.match(home, /<meta property="og:image" content="https:\/\/haus\.example\/media\/share\.jpg">/)
  const css = fs.readFileSync(path.join(result.outDir, 'assets', 'styles.css'), 'utf8')
  assert.match(css, /--asset-logo:\s*url\(["']?\/media\/logo\.png["']?\)/)
  assert.match(css, /--asset-muster:/)
  assert.equal(css.includes('--asset-bad'), false)
  assert.equal(css.includes('elsewhere.example'), false)
  assert.deepEqual(readSiteConfig(root).assets, { logo: '/media/logo.png', favicon: '/media/icon.png', social: '/media/share.jpg', muster: '/media/logo.png' })
})

test('site pictures are checked: a name, an address outside the site, and a picture that is not there', () => {
  const root = newSite('housing-asset-problems-')
  fs.writeFileSync(path.join(root, 'media', 'logo.png'), 'png')
  assert.deepEqual(assetProblems(root, { logo: '/media/logo.png' }), [])
  const problems = assetProblems(root, { 'Logo Big': '/media/logo.png', icon: 'https://x.example/i.png', favicon: '/media/fehlt.png' })
  assert.equal(problems.length, 3)
  assert.match(problems[0], /name must be lowercase/)
  assert.match(problems[1], /not a picture address/)
  assert.match(problems[2], /not in this site\. Save the picture with save_picture first/)
})

test('a setup keeps the site pictures when it rewrites the site, and takes new ones from the proposal', () => {
  const root = newSite('housing-asset-setup-')
  fs.writeFileSync(path.join(root, 'media', 'logo.png'), 'png')
  fs.writeFileSync(path.join(root, 'media', 'icon.png'), 'png')
  applyProposal(root, { site: { name: 'Haus', assets: { logo: '/media/logo.png' } } })
  applyProposal(root, { site: { name: 'Haus zwei', assets: { favicon: '/media/icon.png' } } })
  assert.deepEqual(readSiteConfig(root).assets, { logo: '/media/logo.png', favicon: '/media/icon.png' })
  assert.deepEqual(recordProposal(root, { site: { assets: { logo: '/media/nirgends.png' } } }).length, 1)
  assert.throws(() => applyProposal(root, { site: { assets: { logo: '/media/nirgends.png' } } }), /not in this site/)
})

function png(colorType: number, extra: Buffer[] = []): Buffer {
  const chunk = (type: string, data: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, data.length]), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(40, 0)
  header.writeUInt32BE(20, 4)
  header[8] = 8
  header[9] = colorType
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), ...extra, chunk('IDAT', Buffer.from([1, 2, 3]))])
}

test('a picture that can be see-through is told apart from one that cannot', () => {
  assert.equal(hasTransparency(png(2)), false)
  assert.equal(hasTransparency(png(6)), true)
  assert.equal(hasTransparency(png(4)), true)
  const chunk = Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.from('tRNS', 'latin1'), Buffer.from([0]), Buffer.alloc(4)])
  assert.equal(hasTransparency(png(3, [chunk])), true)
  assert.equal(hasTransparency(png(3)), false)
  const webp = (kind: string, flagsAt: number, flag: number) => {
    const bytes = Buffer.alloc(40)
    bytes.write('RIFF', 0, 'latin1')
    bytes.write('WEBP', 8, 'latin1')
    bytes.write(kind, 12, 'latin1')
    bytes[flagsAt] = flag
    return bytes
  }
  assert.equal(hasTransparency(webp('VP8X', 20, 0x10)), true)
  assert.equal(hasTransparency(webp('VP8X', 20, 0x00)), false)
  assert.equal(hasTransparency(webp('VP8L', 24, 0x10)), true)
  assert.equal(hasTransparency(webp('VP8L', 24, 0x00)), false)
  assert.equal(hasTransparency(webp('VP8 ', 24, 0xff)), false)
  assert.equal(hasTransparency(Buffer.from('GIF89a......')), true)
  assert.equal(hasTransparency(Buffer.from('<?xml version="1.0"?>\n<!-- logo --><svg xmlns="http://www.w3.org/2000/svg"></svg>')), true)
  assert.equal(hasTransparency(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])), false)
  assert.equal(hasTransparency(Buffer.from('plain text')), false)
})

test('a logo with see-through parts is marked, and the starter keeps its loading color off it', () => {
  const root = newSite('housing-transparent-')
  fs.writeFileSync(path.join(root, 'media', 'logo.png'), png(6))
  fs.writeFileSync(path.join(root, 'media', 'foto.png'), png(2))
  const file = path.join(root, 'design', 'site.yml')
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}\nassets:\n  logo: /media/logo.png\n`)
  const page = path.join(root, 'content', 'pages', 'kontakt.yml')
  const result = generate(root)
  const home = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8')
  assert.match(home, /<img[^>]+src="\/media\/logo\.png"[^>]*data-transparent/)
  assert.equal(fs.existsSync(page), true)
  const css = fs.readFileSync(path.join(result.outDir, 'assets', 'styles.css'), 'utf8')
  assert.match(css, /img:not\(\[data-transparent\]\)/)
})

test('the search index holds pages, posts and events in each language, and the search page is not listed for search engines', () => {
  const root = newSite('housing-search-')
  writePage(root, { slug: 'werkstatt', layout: 'article', title: { de: 'Werkstatt', en: 'Workshop' }, slots: { body: { de: 'Hier wird gelötet und gesägt. Öffnungszeiten: Straße 5.', en: 'We solder and saw here.' } } })
  writePage(root, { slug: 'dach', layout: 'article', date: '2025-03-04', title: { de: 'Neues Dach', en: 'New roof' }, slots: { body: { de: 'Das Dach ist fertig & dicht.', en: 'The roof is done.' } } })
  fs.mkdirSync(path.join(root, 'content', 'events'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'content', 'events', 'fest.yml'),
    ['slug: fest', 'title:', '  de: Sommerfest', '  en: Summer party', 'body:', '  de: Grillen im Hof.', 'place: haus', 'categories: []', 'dates:', '  - start: 2031-07-05T16:00:00.000Z'].join('\n'),
  )
  const result = generate(root)
  const de = JSON.parse(fs.readFileSync(path.join(result.outDir, 'search-index.de.json'), 'utf8')) as { t: string; u: string; k: string; x: string; d?: string }[]
  const en = JSON.parse(fs.readFileSync(path.join(result.outDir, 'search-index.en.json'), 'utf8')) as { t: string; u: string; k: string; x: string }[]
  type Found = { t: string; u: string; k: string; x: string; d?: string }
  const byTitle = (list: Found[], title: string) => list.find((entry) => entry.t === title)
  assert.equal(byTitle(de, 'Werkstatt')?.k, 'page')
  assert.match(byTitle(de, 'Werkstatt')?.x ?? '', /gelötet und gesägt\. Öffnungszeiten/)
  assert.equal(byTitle(de, 'Neues Dach')?.k, 'post')
  assert.equal(byTitle(de, 'Neues Dach')?.d, '2025-03-04')
  assert.match(byTitle(de, 'Neues Dach')?.x ?? '', /fertig & dicht/)
  assert.equal(byTitle(de, 'Sommerfest')?.k, 'event')
  assert.match(byTitle(de, 'Sommerfest')?.x ?? '', /Grillen im Hof/)
  assert.equal(byTitle(en, 'Workshop')?.u, '/en/werkstatt/')
  assert.equal(byTitle(en, 'Summer party')?.k, 'event')
  // The lists and the pages the site makes are not in it, and neither is the menu.
  assert.equal(de.some((entry) => /^(Aktuelles|Kalender|Termine|Suche|Seite nicht gefunden)$/.test(entry.t)), false)
  assert.equal(JSON.stringify(de).includes('Zum Inhalt springen'), false)
  const search = fs.readFileSync(path.join(result.outDir, 'suche', 'index.html'), 'utf8')
  assert.match(search, /<meta name="robots" content="noindex, follow">/)
  assert.match(search, /data-index="\/search-index\.de\.json"/)
  assert.match(fs.readFileSync(path.join(result.outDir, 'en', 'suche', 'index.html'), 'utf8'), /data-index="\/search-index\.en\.json"/)
  const home = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8')
  assert.match(home, /<form class="site-search[^"]*" role="search" action="\/suche\/" method="get">/)
  assert.equal(home.includes('noindex'), false)
  fs.writeFileSync(path.join(root, 'design', 'site.yml'), `${fs.readFileSync(path.join(root, 'design', 'site.yml'), 'utf8')}\nurl: https://haus.example\n`)
  const sitemap = fs.readFileSync(path.join(generate(root).outDir, 'sitemap.xml'), 'utf8')
  assert.equal(sitemap.includes('/suche/'), false)
  assert.match(sitemap, /\/werkstatt\//)
})

test('a site made before the search has neither its page nor its index', () => {
  const root = newSite('housing-no-search-')
  fs.rmSync(path.join(root, 'design', 'layouts', 'search'), { recursive: true, force: true })
  const result = generate(root)
  assert.equal(fs.existsSync(path.join(result.outDir, 'search-index.de.json')), false)
  assert.equal(fs.existsSync(path.join(result.outDir, 'suche', 'index.html')), false)
  assert.equal(fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8').includes('role="search"'), false)
})

test('the words of a page are its main part as plain text, and a big site keeps less of each page', () => {
  assert.equal(
    searchText('<html><body><header><nav>Menü</nav></header><main><h1>Titel</h1><p>Ein&nbsp;Satz &amp; &#228;ndern <script>x()</script><b>fett</b></p><form>Suche</form></main><footer>Fuß</footer></body></html>'),
    'Titel Ein Satz & ändern fett',
  )
  assert.equal(searchText('<main>' + 'wort '.repeat(1000) + '</main>', 100).length <= 100, true)
  assert.ok(textLimit(100) > textLimit(500) && textLimit(500) > textLimit(900))
  const big = JSON.parse(searchIndexJson(Array.from({ length: 900 }, (_value, index) => ({ t: `T${index}`, u: `/${index}/`, k: 'page' as const, x: 'wort '.repeat(500) })))) as { x: string }[]
  assert.ok(big[0].x.length <= 400)
})

test('the links to the other languages are whole addresses with the page itself and x-default, once the site has its address', () => {
  const root = newSite('housing-hreflang-')
  const before = generate(root)
  const relative = fs.readFileSync(path.join(before.outDir, 'index.html'), 'utf8')
  assert.match(relative, /<link rel="alternate" hreflang="en" href="\/en\/">/)
  assert.equal(relative.includes('x-default'), false)
  const file = path.join(root, 'design', 'site.yml')
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}\nurl: https://haus.example\n`)
  const result = generate(root)
  const de = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8')
  assert.match(de, /<link rel="alternate" hreflang="en" href="https:\/\/haus\.example\/en\/">/)
  assert.match(de, /<link rel="alternate" hreflang="de" href="https:\/\/haus\.example\/">/)
  assert.match(de, /<link rel="alternate" hreflang="x-default" href="https:\/\/haus\.example\/">/)
  const en = fs.readFileSync(path.join(result.outDir, 'en', 'index.html'), 'utf8')
  assert.match(en, /<link rel="alternate" hreflang="de" href="https:\/\/haus\.example\/">/)
  assert.match(en, /<link rel="alternate" hreflang="en" href="https:\/\/haus\.example\/en\/">/)
  assert.match(en, /<link rel="alternate" hreflang="x-default" href="https:\/\/haus\.example\/">/)
  assert.equal((de.match(/hreflang="de"/g) ?? []).length, 1)
  assert.equal((de.match(/hreflang="x-default"/g) ?? []).length, 1)
})

test('the starter shows the dates of an event as people read them, in a time element', () => {
  const root = newSite('housing-event-dates-')
  fs.mkdirSync(path.join(root, 'content', 'events'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'content', 'events', 'fest.yml'),
    ['slug: fest', 'title:', '  de: Fest', '  en: Party', 'body:', '  de: Kommt.', '  en: Come.', 'place: hof', 'categories: []', 'dates:', '  - start: 2031-07-05T16:00:00.000Z', '    end: 2031-07-05T22:00:00.000Z'].join('\n'),
  )
  const page = fs.readFileSync(path.join(generate(root).outDir, 'events', 'fest', 'index.html'), 'utf8')
  assert.match(page, /<time datetime="2031-07-05T16:00:00\.000Z">5\. Juli 2031, 18:00<\/time> – <time datetime="2031-07-05T22:00:00\.000Z">/)
  assert.equal(page.includes('>2031-07-05T16:00:00.000Z<'), false)
})
