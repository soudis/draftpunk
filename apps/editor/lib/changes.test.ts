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
    describeDraftChange('content/pages/kontakt/de.md', 'M', '---\ntitle: Kontakt\n---\n\nHallo\n', languages),
    'Updated the Deutsch page Kontakt',
  )
  assert.equal(
    describeDraftChange('content/pages/notes/en.md', 'D', '---\ntitle: Notes\n---\n', languages),
    'Removed the English page Notes',
  )
  assert.equal(
    describeDraftChange('content/events/sommer.yml', 'A', 'title:\n  de: Sommerfest\n  en: Summer party\n', languages),
    'Added the event Sommerfest',
  )
  assert.equal(describeDraftChange('media/hof.webp', 'A', '', languages), 'Added the picture hof.webp')
  assert.equal(describeDraftChange('design/styles.css', 'M', '', languages), 'Changed the stylesheet')
  assert.equal(describeDraftChange('design/layouts/home.yml', 'M', '', languages), 'Changed the home layout')
  assert.equal(
    describeDraftChange(
      'content/pages/job/de.md',
      'M',
      '---\ntitle: >-\n  SchloR-Job: Förderungen\n  ab sofort\ndate: 2021-03-31\n---\n',
      languages,
    ),
    'Updated the Deutsch page SchloR-Job: Förderungen ab sofort',
  )
})

test('publish lists the draft against the public site', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-changes-'))
  ensureGit(root)
  assert.deepEqual(publishChanges(root), [])
  const page = path.join(root, 'content', 'pages', 'home', 'de.md')
  fs.appendFileSync(page, '\nA new line.\n')
  commitAll(root, 'Edit the homepage', { name: 'Ada', email: 'ada@schlor.org' })
  assert.deepEqual(publishChanges(root), ['Updated the Deutsch page Housing project'])
})
