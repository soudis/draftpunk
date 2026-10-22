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

test('the editing prompt keeps content and design apart and names the catalog', () => {
  const prompt = systemPrompt('edit', site())
  assert.match(prompt, /A layout holds no words of its own/)
  assert.match(prompt, /Before you write a layout, call list_layouts/)
  assert.match(prompt, /ask before you replace a sentence/)
  assert.match(prompt, /Claim something changed only after the tool confirmed it/)
  assert.match(prompt, /A layout's purpose belongs in its own layout\.yml/)
  assert.match(prompt, /Layouts:\n- allies — /)
  assert.match(prompt, /- article — A plain text page[^\n]*\n {2}slots: body:markdown\*/)
  assert.equal(prompt.includes('propose_setup'), false)
  assert.equal(prompt.includes('read_site'), false)
})

test('setup adds its own rules and keeps the editing rules', () => {
  const root = site()
  const setup = systemPrompt('setup', root)
  assert.match(setup, /propose_setup/)
  assert.match(setup, /read the site as described under Other sites/)
  assert.match(setup, /A layout holds no words of its own/)
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
  assert.ok('accept_setup' in tools && 'write_page' in tools && 'write_design' in tools && 'write_layout' in tools)
  assert.equal('accept_setup' in toolsFor('edit', site()), false)
})
