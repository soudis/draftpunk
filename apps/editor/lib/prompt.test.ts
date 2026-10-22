import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite } from '@schlor/generator'
import { systemPrompt } from './prompt'
import { toolsFor } from './tools'

function site() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-prompt-'))
  initSite(root)
  return root
}

test('the editing prompt keeps content and design apart and names the tool contracts', () => {
  const prompt = systemPrompt('edit', site())
  assert.match(prompt, /write_page takes every language at once/)
  assert.match(prompt, /call fit_picture for a picture on a page you are writing/i)
  assert.match(prompt, /ask before you replace a sentence/)
  assert.match(prompt, /each of those pages keeps its sentences/)
  assert.match(prompt, /Claim a section changed only after its field was written/)
  assert.match(prompt, /A one-page layout change leaves the shared look/)
  assert.match(prompt, /rewrite it from the stylesheet, the shell, and the layouts/)
  assert.equal(prompt.includes('propose_setup'), false)
  assert.equal(prompt.includes('read_site'), false)
})

test('setup adds its own rules and keeps the editing rules', () => {
  const root = site()
  const setup = systemPrompt('setup', root)
  assert.match(setup, /propose_setup/)
  assert.match(setup, /call read_website for that page and again for each further page/)
  assert.match(setup, /Claim a section changed only after its field was written/)
})

test('the static rules come first and the site comes last, so a changed brief keeps the cached prefix', () => {
  const root = site()
  const before = systemPrompt('edit', root, new Date('2026-10-22T10:00:00Z'))
  fs.writeFileSync(path.join(root, 'design', 'brief.md'), '# Brief\n\nBold colors.\n')
  const after = systemPrompt('edit', root, new Date('2026-10-23T10:00:00Z'))
  const marker = '# This site'
  assert.equal(before.slice(0, before.indexOf(marker)), after.slice(0, after.indexOf(marker)))
  assert.match(before, /Today: 2026-10-22 \(Europe\/Vienna\)/)
  assert.match(after, /Bold colors\./)
  assert.ok(before.indexOf(marker) > before.length / 2)
})

test('every tool says what it needs, and none of them is a mode switch', () => {
  const tools = toolsFor('setup', site())
  assert.equal('reject_tool' in tools, false)
  assert.equal('read_site' in tools, false)
  assert.ok('accept_setup' in tools && 'write_page' in tools && 'write_design' in tools)
  assert.equal('accept_setup' in toolsFor('edit', site()), false)
})
