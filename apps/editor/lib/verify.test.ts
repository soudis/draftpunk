import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { initSite, writePage } from '@schlor/generator'
import { attachScreenshots } from './agent'
import { closeBrowser } from './browser'
import { ScreenshotStore, screenshotIds, screenshotMarker } from './screenshots'
import { designTools, toolsFor } from './tools'
import { createVerifier, pagesToCheck, verifyDesign } from './verify'

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file))
const call = { toolCallId: 'verify', messages: [] as never[] }

function newSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-verify-'))
  initSite(root)
  return root
}

function withBrowser<T>(run: () => Promise<T>): Promise<T> {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  return run().finally(async () => {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  })
}

test('a design change is checked on the pages that show it', () => {
  const root = newSite()
  assert.deepEqual(pagesToCheck(root, 'article'), ['/datenschutz/', '/impressum/'])
  assert.deepEqual(pagesToCheck(root, 'calendar'), ['/kalender/'])
  assert.deepEqual(pagesToCheck(root, 'event'), [])
  assert.deepEqual(pagesToCheck(root, 'room'), [])
  assert.deepEqual(pagesToCheck(root), ['/', '/datenschutz/'])
  writePage(root, { slug: 'raum', layout: 'room', title: { de: 'Raum' }, slots: {} })
  assert.deepEqual(pagesToCheck(root), ['/', '/datenschutz/', '/raum/'])
})

test('without a browser nothing is checked and the tools do not mention one', async () => {
  const root = newSite()
  delete process.env.BROWSER_PATH
  delete process.env.BROWSER_URL
  assert.equal(await verifyDesign(root, createVerifier()), '')
  const names = Object.keys(toolsFor('edit', root, { vision: true }))
  assert.equal(names.includes('check_page'), false)
  assert.equal(names.includes('preview_page'), false)
})

test('a picture is put before the model for one step', () => {
  const store = new ScreenshotStore()
  const id = store.add(Buffer.from([0xff, 0xd8, 0xff]))
  assert.deepEqual(screenshotIds(`Picture of /. ${screenshotMarker(id)}`), [id])
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Look' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'preview_page', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'preview_page', output: { type: 'text', value: `Picture. ${screenshotMarker(id)}` } }] },
  ]
  const shown = attachScreenshots(messages, store)
  assert.equal(shown.length, 4)
  const last = shown[3]
  assert.equal(last.role, 'user')
  assert.match(JSON.stringify(last.content), /"type":"image"/)
  assert.equal(attachScreenshots([...messages, { role: 'assistant', content: [{ type: 'text', text: 'Nice.' }] }], store).length, 4)
  assert.equal(attachScreenshots(messages.slice(0, 2), store).length, 2)
  const stale = [...messages.slice(0, 2), { role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: 'a', toolName: 'preview_page', output: { type: 'text' as const, value: `Gone. ${screenshotMarker('s99')}` } }] }]
  assert.equal(attachScreenshots(stale, store).length, 3)
})

test('after a design change the browser reports a problem once, and check_page reports it again on request', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  await withBrowser(async () => {
    const root = newSite()
    const tools = designTools(root)
    const layout = {
      name: 'dim',
      purpose: 'A page with pale text.',
      slots: { body: 'markdown' },
      template: '{% extends "shell.njk" %}{% block body %}<div class="box"><h1>{{ title }}</h1>{{ slots.body }}</div>{% endblock %}',
      style: '.box { background: #e7e1d5; color: #ffffff; padding: 2rem; }\n',
    }
    const first = String(await tools.write_layout.execute!(layout, call))
    assert.match(first, /Wrote layout dim\./)
    assert.equal(first.includes('browser'), false)
    writePage(root, { slug: 'blass', layout: 'dim', title: { de: 'Blass' }, slots: { body: { de: 'Heller Text auf hellem Grund.' } } })
    const second = String(await tools.edit_layout.execute!({ name: 'dim', part: 'style', find: 'padding: 2rem;', replace: 'padding: 3rem;' }, call))
    assert.match(second, /Checked in a browser:\n- \/blass\/ \(mobile\): Text #ffffff on #e7e1d5 has contrast 1\.3:1/)
    assert.match(second, /Fix these before you finish\./)
    const third = String(await tools.edit_layout.execute!({ name: 'dim', part: 'style', find: 'padding: 3rem;', replace: 'padding: 4rem;' }, call))
    assert.match(third, /nothing new is wrong/)
    assert.equal(third.includes('contrast'), false)
    const repaired = String(await tools.edit_layout.execute!({ name: 'dim', part: 'style', find: 'color: #ffffff;', replace: 'color: #1c1917;' }, call))
    assert.match(repaired, /nothing new is wrong/)
    const checked = await toolsFor('edit', root, {}).check_page.execute!({ page: 'blass', viewport: 'mobile' }, call)
    assert.match(String(checked), /No problems found on \/blass\/ at mobile width/)
    const gone = await toolsFor('edit', root, {}).check_page.execute!({ page: 'nope', viewport: 'desktop' }, call)
    assert.match(String(gone), /Problems on \/nope\/:\n- desktop: The page shows almost no text\./)
  })
})

test('preview_page is offered only to a model that reads pictures, and its picture is kept for the next step', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  await withBrowser(async () => {
    const root = newSite()
    assert.equal('preview_page' in toolsFor('edit', root, {}), false)
    const store = new ScreenshotStore()
    const tools = toolsFor('edit', root, { vision: true, screenshots: store })
    assert.ok('preview_page' in tools && 'check_page' in tools)
    const result = String(await tools.preview_page.execute!({ page: 'home', viewport: 'mobile', full: true }, call))
    const [id] = screenshotIds(result)
    assert.match(result, /Picture of \/ at mobile width, whole page\./)
    assert.ok(id)
    assert.ok((store.get(id)?.data.length ?? 0) > 1000)
  })
})
