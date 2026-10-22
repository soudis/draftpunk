import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { describeDraftChange, publishChanges } from './changes'
import { commitAll, ensureGit } from './git'

const languages = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
]

test('draft changes become sentences', () => {
  assert.equal(
    describeDraftChange('content/pages/kontakt.yml', 'M', 'layout: article\ntitle:\n  de: Kontakt\n  en: Contact\nslots: {}\n', languages),
    'Updated the page Kontakt',
  )
  assert.equal(
    describeDraftChange('content/pages/notes.yml', 'D', 'title:\n  en: Notes\n', languages),
    'Removed the page Notes',
  )
  assert.equal(
    describeDraftChange('content/events/sommer.yml', 'A', 'title:\n  de: Sommerfest\n  en: Summer party\n', languages),
    'Added the event Sommerfest',
  )
  assert.equal(describeDraftChange('media/hof.webp', 'A', '', languages), 'Added the picture hof.webp')
  assert.equal(describeDraftChange('design/styles.css', 'M', '', languages), 'Changed the stylesheet')
  assert.equal(describeDraftChange('design/layouts/home/template.njk', 'M', '', languages), 'Changed the home layout')
  assert.equal(describeDraftChange('design/layouts/home/style.css', 'A', '', languages), 'Added the home layout')
  assert.equal(describeDraftChange('design/labels.yml', 'M', '', languages), 'Changed the labels')
})

test('publish lists the draft against the public site', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-changes-'))
  ensureGit(root)
  assert.deepEqual(publishChanges(root), [])
  const page = path.join(root, 'content', 'pages', 'home.yml')
  fs.appendFileSync(page, '# a new line\n')
  fs.appendFileSync(path.join(root, 'design', 'layouts', 'home', 'template.njk'), '{# a note #}\n')
  fs.appendFileSync(path.join(root, 'design', 'layouts', 'home', 'style.css'), '/* a note */\n')
  commitAll(root, 'Edit the homepage', { name: 'Ada', email: 'ada@schlor.org' })
  assert.deepEqual(publishChanges(root), ['Updated the page Wohnprojekt', 'Changed the home layout'])
})
