import assert from 'node:assert/strict'
import test from 'node:test'
import { designContentRefusal } from './layout-guard'

const pages = [{ slug: 'direktkredite', title: 'Direktkredite' }]

test('a layout or shell that names a page is refused, and a slot template is kept', () => {
  assert.match(designContentRefusal('shell.njk', "pathname.includes('direktkredit')", pages) ?? '', /direktkredite/)
  assert.match(designContentRefusal('layouts/article.njk', "{% set isDk = (title == 'Direktkredite') %}", pages) ?? '', /Direktkredite/)
  assert.equal(designContentRefusal('nav.yml', "{% set isDk = (title == 'Direktkredite') %}", pages), null)
  assert.match(designContentRefusal('layouts/article.njk', '<img src="/media/hof.png">', pages) ?? '', /picture address/)
  assert.equal(designContentRefusal('shell.njk', '<img src="/media/logo.png" alt="SchloR">', pages), null)
  assert.match(
    designContentRefusal('layouts/kredit.njk', 'Du kannst den Zinssatz zwischen 0% und 1,5% frei wählen und jederzeit kündigen.', pages) ?? '',
    /page text/,
  )
  assert.equal(designContentRefusal('layouts/kredit.njk', '<p>{{ slots.badge }}</p>', pages), null)
  assert.equal(designContentRefusal('layouts/kredit.njk', '<p>Mehr erfahren</p>', pages), null)
  assert.equal(
    designContentRefusal('shell.njk', '<p>Du kannst den Zinssatz zwischen 0% und 1,5% frei wählen und jederzeit kündigen.</p>', pages),
    null,
  )
})

test('a layout may hold an SVG path and a class list', () => {
  const path = '<svg><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"></path></svg>'
  const classes = '<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-4 hover:bg-mist"></div>'
  const stored = "{% set row = 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-4 hover:bg-mist' %}"
  assert.equal(designContentRefusal('layouts/front.njk', path, pages), null)
  assert.equal(designContentRefusal('layouts/front.njk', classes, pages), null)
  assert.equal(designContentRefusal('layouts/front.njk', stored, pages), null)
})

test('a sentence in visible text, a reader attribute, or a Nunjucks string is refused', () => {
  const sentence = 'Du kannst den Zinssatz zwischen 0% und 1,5% frei wählen und jederzeit kündigen.'
  assert.match(designContentRefusal('layouts/front.njk', `<p>${sentence}</p>`, pages) ?? '', /Zinssatz/)
  assert.match(designContentRefusal('layouts/front.njk', `<img alt="${sentence}">`, pages) ?? '', /Zinssatz/)
  assert.match(designContentRefusal('layouts/front.njk', `<input placeholder="${sentence}">`, pages) ?? '', /Zinssatz/)
  assert.match(designContentRefusal('layouts/front.njk', `<button aria-label="${sentence}"></button>`, pages) ?? '', /Zinssatz/)
  assert.match(designContentRefusal('layouts/front.njk', `{% set blurb = '${sentence}' %}`, pages) ?? '', /Zinssatz/)
})
