import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { commitAll, ensureGit, git, pointPublishedAtDraft } from './git'
import { commitDetail, fileDiff, kindOf, knownRevision, listHistory, pictureAt, restoreDraft, restoreFile, restorePreview, undoChange } from './history-log'

const author = { name: 'Alex', email: 'alex@example.org' }

function history(): { root: string; first: string; second: string; third: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-history-'))
  ensureGit(root)
  const kontakt = path.join(root, 'content', 'pages', 'kontakt.yml')
  fs.appendFileSync(kontakt, '# one\n')
  const first = commitAll(root, 'Make the contact page warmer', author, 'reply') as string
  fs.appendFileSync(path.join(root, 'content', 'pages', 'impressum.yml'), '# two\n')
  const second = commitAll(root, 'Updated the page Impressum', author, 'edit') as string
  fs.appendFileSync(kontakt, '# three\n')
  const third = commitAll(root, 'Updated the page Kontakt', author, 'edit') as string
  return { root, first, second, third }
}

test('the history is the draft newest first, with the public site and the newest change marked', () => {
  const { root, third } = history()
  const { entries, total } = listHistory(root)
  assert.equal(total, 4)
  assert.equal(entries[0].revision, third)
  assert.equal(entries[0].isHead, true)
  assert.equal(entries[3].subject, 'Initial site')
  assert.equal(entries[3].isPublic, true)
  assert.deepEqual(entries.map((entry) => entry.kind), ['edit', 'edit', 'reply', 'initial'])
  assert.equal(entries[2].author, 'Alex')
  assert.equal(listHistory(root, 1, 2).entries.length, 2)
})

test('commits from before the trailers are told apart by their message', () => {
  assert.equal(kindOf('Initial site', ''), 'initial')
  assert.equal(kindOf('Revert "Make it blue"', ''), 'undo')
  assert.equal(kindOf('Save picture hof.webp', ''), 'picture')
  assert.equal(kindOf('Corrected text in content/pages/a.yml', ''), 'edit')
  assert.equal(kindOf('Make it blue', ''), 'change')
  assert.equal(kindOf('Publish the draft', 'publish'), 'publish')
})

test('a change lists its files as sentences, and a file shows its lines', () => {
  const { root, second } = history()
  const detail = commitDetail(root, second)
  assert.deepEqual(detail.changes.map((change) => [change.file, change.sentence]), [['content/pages/impressum.yml', 'Updated the page Impressum']])
  assert.match(fileDiff(root, second, 'content/pages/impressum.yml').text, /\+# two/)
  assert.throws(() => fileDiff(root, second, '../secret'))
})

test('only hashes of the draft are accepted', () => {
  const { root, first } = history()
  assert.equal(knownRevision(root, first), first)
  assert.equal(knownRevision(root, first.slice(0, 8)), first)
  assert.throws(() => knownRevision(root, 'main'))
  assert.throws(() => knownRevision(root, '--help'))
  assert.throws(() => knownRevision(root, 'deadbeef'))
})

test('a restore says what it would change, and writes a new change instead of dropping any', () => {
  const { root, first, third } = history()
  assert.deepEqual(restorePreview(root, first), ['Updated the page Impressum', 'Updated the page Kontakt'])
  const result = restoreDraft(root, first, author)
  assert.ok(result.ok)
  assert.equal(fs.readFileSync(path.join(root, 'content', 'pages', 'impressum.yml'), 'utf8').includes('# two'), false)
  assert.equal(fs.readFileSync(path.join(root, 'content', 'pages', 'kontakt.yml'), 'utf8').includes('# three'), false)
  assert.ok(fs.readFileSync(path.join(root, 'content', 'pages', 'kontakt.yml'), 'utf8').includes('# one'))
  const { entries, total } = listHistory(root)
  assert.equal(total, 5)
  assert.equal(entries[0].kind, 'restore')
  // The state before the restore is still in the history and can be restored again.
  assert.ok(restoreDraft(root, third, author).ok)
  assert.ok(fs.readFileSync(path.join(root, 'content', 'pages', 'impressum.yml'), 'utf8').includes('# two'))
})

test('a restore to the state the draft already has says so', () => {
  const { root, third } = history()
  const result = restoreDraft(root, third, author)
  assert.equal(result.ok, false)
})

test('a restore waits while a reply is writing files', () => {
  const { root, first } = history()
  fs.appendFileSync(path.join(root, 'content', 'pages', 'home.yml'), '# half done\n')
  const result = restoreDraft(root, first, author)
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error, /reply/)
  assert.ok(fs.readFileSync(path.join(root, 'content', 'pages', 'home.yml'), 'utf8').includes('# half done'))
})

test('one file can be put back and the rest stays', () => {
  const { root, first } = history()
  const result = restoreFile(root, first, 'content/pages/kontakt.yml', author)
  assert.ok(result.ok)
  assert.equal(fs.readFileSync(path.join(root, 'content', 'pages', 'kontakt.yml'), 'utf8').includes('# three'), false)
  assert.ok(fs.readFileSync(path.join(root, 'content', 'pages', 'impressum.yml'), 'utf8').includes('# two'))
  assert.equal(restoreFile(root, first, 'content/pages/kontakt.yml', author).ok, false)
})

test('a file the older change did not have is taken out again', () => {
  const { root, first } = history()
  fs.writeFileSync(path.join(root, 'content', 'pages', 'neu.yml'), 'layout: article\ntitle:\n  de: Neu\nslots: {}\n')
  commitAll(root, 'Added the page Neu', author, 'edit')
  assert.ok(restoreFile(root, first, 'content/pages/neu.yml', author).ok)
  assert.equal(fs.existsSync(path.join(root, 'content', 'pages', 'neu.yml')), false)
})

test('one change can be undone when no later change edited its files', () => {
  const { root, second, first } = history()
  assert.ok(undoChange(root, second, author).ok)
  assert.equal(fs.readFileSync(path.join(root, 'content', 'pages', 'impressum.yml'), 'utf8').includes('# two'), false)
  const blocked = undoChange(root, first, author)
  assert.equal(blocked.ok, false)
  assert.match(blocked.ok ? '' : blocked.error, /later change edited/)
  assert.equal(listHistory(root).entries[0].kind, 'undo')
})

test('the history can show the public site pointing at an older change', () => {
  const { root, third } = history()
  pointPublishedAtDraft(root)
  const { entries } = listHistory(root)
  assert.equal(entries.filter((entry) => entry.isPublic).length, 1)
  assert.equal(entries.find((entry) => entry.isPublic)?.revision, third)
  fs.appendFileSync(path.join(root, 'content', 'pages', 'home.yml'), '# later\n')
  commitAll(root, 'Later', author)
  assert.equal(listHistory(root).entries.find((entry) => entry.isPublic)?.revision, third)
  assert.equal(git(root, ['rev-parse', 'main']).trim(), third)
})

test('a picture can be shown as a change left it, and only a picture', () => {
  const { root } = history()
  fs.mkdirSync(path.join(root, 'media'), { recursive: true })
  fs.writeFileSync(path.join(root, 'media', 'hof.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const added = commitAll(root, 'Save picture hof.svg', author, 'picture') as string
  assert.equal(pictureAt(root, added, 'media/hof.svg', 'after')?.mediaType, 'image/svg+xml')
  assert.equal(pictureAt(root, added, 'media/hof.svg', 'before'), null)
  assert.throws(() => pictureAt(root, added, 'content/pages/home.yml', 'after'))
})
