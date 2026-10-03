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
})
