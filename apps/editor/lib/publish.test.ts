import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { publishSite } from './publish'
import { ensureGit, git } from './git'

test('publish stays off until the public host is switched on', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-pub-'))
  ensureGit(root)
  const previous = process.env.WEBSITE_ALLOW_PUBLISH
  delete process.env.WEBSITE_ALLOW_PUBLISH
  assert.throws(() => publishSite(root, { name: 'Ada', email: 'ada@schlor.org' }, 'Publish'), /switched on/)
  if (previous) process.env.WEBSITE_ALLOW_PUBLISH = previous
})

test('publish points main at the draft and writes the public files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-pub-'))
  ensureGit(root)
  process.env.WEBSITE_ALLOW_PUBLISH = '1'
  process.env.SITE_ROOT = root
  const result = publishSite(root, { name: 'Ada', email: 'ada@schlor.org' }, 'First public site')
  assert.match(result.revision, /^[0-9a-f]{40}$/)
  assert.equal(git(root, ['rev-parse', 'main']).trim(), result.revision)
  assert.equal(fs.existsSync(path.join(root, 'published', 'index.html')), true)
  delete process.env.WEBSITE_ALLOW_PUBLISH
  delete process.env.SITE_ROOT
})
