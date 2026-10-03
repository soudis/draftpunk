import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { revertDraft, undoLastReply } from './draft'
import { commitAll, ensureGit, git } from './git'
import { migrate, recordReplyCommit, replyCommit } from './sessions'

const author = { name: 'Ada', email: 'ada@schlor.org' }

function site() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-draft-'))
  ensureGit(root, author)
  const published = path.join(root, 'published')
  fs.mkdirSync(published)
  fs.writeFileSync(path.join(published, 'index.html'), 'public')
  return root
}

function memory() {
  const opened = new Database(':memory:')
  migrate(opened)
  return opened
}

test('undo restores the reply when a later change edited other files', () => {
  const root = site()
  const opened = memory()
  const page = path.join(root, 'content', 'pages', 'home', 'de.md')
  const before = fs.readFileSync(page, 'utf8')
  fs.appendFileSync(page, '\nA new line.\n')
  const revision = commitAll(root, 'Change the homepage', author)
  assert.ok(revision)
  recordReplyCommit(opened, 'session', 'message', revision)
  fs.writeFileSync(path.join(root, 'media', 'note.txt'), 'picture stand-in\n')
  commitAll(root, 'Save picture note.txt', author)
  const main = git(root, ['rev-parse', 'main']).trim()
  assert.deepEqual(undoLastReply(root, author, opened), { undone: true })
  assert.equal(fs.readFileSync(page, 'utf8'), before)
  assert.equal(fs.readFileSync(path.join(root, 'media', 'note.txt'), 'utf8'), 'picture stand-in\n')
  assert.equal(git(root, ['rev-parse', 'main']).trim(), main)
  assert.equal(fs.readFileSync(path.join(root, 'published', 'index.html'), 'utf8'), 'public')
  assert.equal(replyCommit(opened), null)
})

test('undo refuses when a later change edited the same file', () => {
  const root = site()
  const opened = memory()
  const page = path.join(root, 'content', 'pages', 'home', 'de.md')
  fs.appendFileSync(page, '\nfirst\n')
  const revision = commitAll(root, 'First edit', author)
  assert.ok(revision)
  recordReplyCommit(opened, 'session', 'message', revision)
  fs.appendFileSync(page, '\nsecond\n')
  commitAll(root, 'Second edit', author)
  const result = undoLastReply(root, author, opened)
  assert.equal(result.undone, false)
  if (!result.undone) assert.match(result.error, /later change/)
  assert.match(fs.readFileSync(page, 'utf8'), /second/)
  assert.equal(replyCommit(opened)?.revision, revision)
})

test('revert draft puts the draft back on the public site', () => {
  const root = site()
  const opened = memory()
  const page = path.join(root, 'content', 'pages', 'home', 'de.md')
  const before = fs.readFileSync(page, 'utf8')
  fs.appendFileSync(page, '\nunpublished\n')
  const revision = commitAll(root, 'Unpublished edit', author)
  assert.ok(revision)
  recordReplyCommit(opened, 'session', 'message', revision)
  const main = git(root, ['rev-parse', 'main']).trim()
  assert.deepEqual(revertDraft(root, opened), { reverted: true })
  assert.equal(git(root, ['rev-parse', 'draft']).trim(), main)
  assert.equal(git(root, ['rev-parse', 'main']).trim(), main)
  assert.equal(fs.readFileSync(page, 'utf8'), before)
  assert.equal(fs.readFileSync(path.join(root, 'published', 'index.html'), 'utf8'), 'public')
  assert.equal(replyCommit(opened), null)
})
