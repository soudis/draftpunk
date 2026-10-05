import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite } from '@schlor/generator'
import { systemPrompt } from './tools'

test('a layout request keeps wording close, and setup does not use that rule', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-prompt-'))
  initSite(root)
  const prompt = systemPrompt('content', root)
  assert.equal(systemPrompt('design', root), prompt)
  assert.match(prompt, /write_page requires slug, lang, title, layout, and body together/)
  assert.match(prompt, /Never send only the body/)
  assert.match(prompt, /call fit_picture with its stored address/)
  assert.match(prompt, /title and body are objects keyed by language id/)
  assert.match(prompt, /When the person asks for a layout or a look/)
  assert.match(prompt, /you ask before you replace a sentence/)
  assert.match(prompt, /every page on it keeps its sentences/)
  assert.match(prompt, /Leave the title in each language/)
  assert.equal(prompt.includes('A save that breaks it'), false)
  assert.match(prompt, /call it again for each further page/)
  assert.match(prompt, /A one-page layout change leaves the shared look/)
  assert.match(prompt, /rewrite the brief from the stylesheet, the shell, and the layouts/)
  assert.match(prompt, /Claim a section changed only after its field was written/)
  const setup = systemPrompt('setup', root)
  assert.equal(setup.includes('you ask before you replace a sentence'), false)
  assert.match(setup, /Call read_site again for each further page/)
  assert.match(setup, /call fit_picture with its stored address/)
  assert.equal(setup.includes('pages linked from it'), false)
})
