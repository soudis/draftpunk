import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { phraseChange } from './correct-phrase'
import { commitPath, ensureGit, git } from './git'

test('a changed word is the phrase sent to the content field', () => {
  assert.equal(phraseChange('Hof', 'Hof'), null)
  assert.deepEqual(phraseChange('Beisl', 'Beisel'), { old: 'Beisl', next: 'Beisel' })
  assert.deepEqual(phraseChange('Beisl and Beisl', 'Beisel and Beisl'), { old: 'Beisl', next: 'Beisel' })
  assert.deepEqual(phraseChange('Beisl,', 'Beisel,'), { old: 'Beisl', next: 'Beisel' })
})

test('a text correction commits only the hinted file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'correct-commit-'))
  const author = { name: 'Ada Lovelace', email: 'ada@schlor.org' }
  ensureGit(root, author)
  fs.writeFileSync(path.join(root, 'media', 'note.txt'), 'picture stand-in\n')
  git(root, ['add', 'media/note.txt'])
  const page = path.join(root, 'content', 'pages', 'home', 'de.md')
  fs.appendFileSync(page, '\nHof.\n')
  const revision = commitPath(root, 'content/pages/home/de.md', 'Corrected text in content/pages/home/de.md', author)
  assert.ok(revision)
  const names = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).trim().split('\n')
  assert.deepEqual(names, ['content/pages/home/de.md'])
  assert.equal(git(root, ['log', '-1', '--format=%an']).trim(), 'Ada Lovelace')
  assert.match(git(root, ['status', '--porcelain']), /note\.txt/)
})
