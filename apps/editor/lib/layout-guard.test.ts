import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, listLayoutNames } from '@schlor/generator'
import { designContentRefusal, namedPages, visibleText } from './layout-guard'

const pages = [{ slug: 'direktkredite', titles: ['Direktkredite', 'Direct loans'] }]

test('a design file that names a page, in any language, is refused', () => {
  assert.match(designContentRefusal('shell.njk', "pathname.includes('direktkredit')", pages) ?? '', /direktkredite/)
  assert.match(designContentRefusal('layouts/article/template.njk', "{% set isDk = (title == 'Direktkredite') %}", pages) ?? '', /Direktkredite/)
  assert.match(designContentRefusal('layouts/article/template.njk', "{% if title == 'direct loans' %}x{% endif %}", pages) ?? '', /Direktkredite/)
  assert.match(designContentRefusal('layouts/article/style.css', '.direktkredite-hero { color: red; }', pages) ?? '', /direktkredite/)
  assert.equal(designContentRefusal('nav.yml', 'label: Direktkredite', pages), null)
  assert.equal(designContentRefusal('layouts/article/layout.yml', 'purpose: Direktkredite', pages), null)
})

test('a picture address in a template or a stylesheet is refused', () => {
  assert.match(designContentRefusal('layouts/article/template.njk', '<img src="/media/hof.png">', pages) ?? '', /picture address/)
  assert.match(designContentRefusal('shell.njk', '<img src="/media/logo.png" alt="">', pages) ?? '', /picture address/)
  assert.match(designContentRefusal('styles.css', '.hero { background: url(/media/hof.jpg); }', pages) ?? '', /picture address/)
})

test('a template holds no words of its own, short or long', () => {
  const sentence = 'Du kannst den Zinssatz zwischen 0% und 1,5% frei wählen und jederzeit kündigen.'
  for (const text of [`<p>${sentence}</p>`, '<p>Mehr erfahren</p>', '<a>Weiter</a>', `<img alt="${sentence}">`, '<input placeholder="Suche">', '<button aria-label="Menü"></button>', `{% set blurb = '${sentence}' %}`, "{{ 'Aktuelles' if lang == 'de' else 'News' }}"]) {
    const refusal = designContentRefusal('layouts/front/template.njk', text, pages)
    assert.match(refusal ?? '', /holds the text/, text)
    assert.match(refusal ?? '', /labels\.name/, text)
  }
  assert.match(designContentRefusal('shell.njk', '<footer>Alle Rechte vorbehalten</footer>', pages) ?? '', /holds the text “Alle Rechte vorbehalten”/)
})

test('slots, labels, symbols, class lists and SVG paths are not words', () => {
  const okay = [
    '<p>{{ slots.badge }}</p>',
    '<h2>{{ labels.news }}</h2>',
    '<footer>© {{ year }} {{ name }} · <a href="/x/">{{ labels.imprint }}</a></footer>',
    '<span aria-hidden="true">&times;</span><button aria-label="{{ labels.menu }}"></button>',
    '<img src="{{ slots.photo }}" alt="">',
    '<svg><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"></path></svg>',
    '<div class="flex flex-wrap items-baseline justify-between gap-x-4 hover:bg-mist"></div>',
    "{% set row = 'flex flex-wrap items-baseline justify-between gap-x-4 p-4' %}",
    "{{ 'text-navy/30' if not day.inMonth }}",
    '{% extends "shell.njk" %}{% block body %}{% endblock %}',
    '{# Ein Kommentar über das Layout #}<p>{{ slots.body }}</p>',
    '<script>const label = "Menü öffnen"</script>',
  ]
  for (const text of okay) assert.equal(designContentRefusal('layouts/front/template.njk', text, pages), null, text)
  assert.equal(visibleText('<p>{{ slots.a }}</p>'), null)
})

test('a stylesheet may not hold words in a content rule', () => {
  assert.match(designContentRefusal('layouts/front/style.css', '.new::after { content: "Neu"; }', pages) ?? '', /content rule/)
  assert.equal(designContentRefusal('layouts/front/style.css', '.dot::after { content: "·"; } .x::before { content: ""; }', pages), null)
  assert.equal(designContentRefusal('styles.css', '/* content: "Neu" */ body { color: red; }', pages), null)
})

test('the starter layouts and shell pass their own guard, and pages are listed with every title', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-guard-'))
  initSite(root)
  const design = path.join(root, 'design')
  const files = [
    'shell.njk',
    'styles.css',
    ...listLayoutNames(design).flatMap((name) => [`layouts/${name}/template.njk`, `layouts/${name}/style.css`]),
  ]
  const named = namedPages(root)
  assert.deepEqual(named.find((page) => page.slug === 'kontakt')?.titles, ['Kontakt', 'Contact'])
  for (const file of files) {
    assert.equal(designContentRefusal(file, fs.readFileSync(path.join(design, file), 'utf8'), named), null, file)
  }
})
