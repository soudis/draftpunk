import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generate, initSite, slotExpectations, writeLayout, writePage } from '@schlor/generator'
import { closeBrowser, decideRoute, PREVIEW_ORIGIN } from './browser'
import { describeAudit, hiddenWords, pagePath, type RawAudit } from './page-audit'

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file))
const quiet = { errors: [], missing: [], hidden: [] }

function audit(over: Partial<RawAudit> = {}): RawAudit {
  return { width: 375, scrollWidth: 375, title: 'T', h1: 1, text: 'x'.repeat(100), invisible: false, brokenImages: [], overflow: [], contrast: [], ...over }
}

test('the audit says what is wrong in sentences', () => {
  assert.deepEqual(describeAudit(audit(), quiet), [])
  assert.deepEqual(describeAudit(audit({ invisible: true, text: '' }), quiet), ['The page is invisible: html or body has opacity 0.'])
  assert.deepEqual(describeAudit(audit({ text: 'Hi' }), quiet), ['The page shows almost no text.'])
  assert.deepEqual(describeAudit(audit({ h1: 0 }), quiet), ['The page has no main heading (h1).'])
  const found = describeAudit(
    audit({
      scrollWidth: 732,
      overflow: [{ sel: 'div.wide', right: 732 }],
      brokenImages: ['/media/a.jpg'],
      contrast: [{ fg: '#ffffff', bg: '#e7e1d5', ratio: 1.3, need: 4.5, sel: 'a.cta', text: 'Join', count: 3 }],
    }),
    { errors: ['boom'], missing: ['/media/a.jpg'], hidden: ['slots.body'] },
  )
  assert.deepEqual(found, [
    'The page scrolls sideways at 375px wide (it is 732px): div.wide reaches 732px.',
    'Pictures that did not load: /media/a.jpg.',
    'Text #ffffff on #e7e1d5 has contrast 1.3:1 and needs 4.5:1: a.cta “Join” and 2 more like it.',
    'These page words are in the page but not visible: slots.body.',
    'Not found: /media/a.jpg.',
    'The page logged an error: boom',
  ])
})

test('words that are on the page but not visible are named, ignoring case and spacing', () => {
  const expectation = { slug: 'a', lang: 'de', url: '/a/', texts: [{ path: 'slots.body', expected: 'Ein Raum.' }, { path: 'slots.lede', expected: 'Hell' }] }
  assert.deepEqual(hiddenWords(expectation, 'EIN  RAUM.\nHELL'), [])
  assert.deepEqual(hiddenWords(expectation, 'Hell'), ['slots.body'])
  assert.deepEqual(hiddenWords(undefined, ''), [])
})

test('a preview request is served from the generated site, and nothing else is reached, fonts included', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'route-'))
  fs.mkdirSync(path.join(dist, 'assets'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<p>x</p>')
  fs.writeFileSync(path.join(dist, 'assets', 'styles.css'), 'a{}')
  assert.deepEqual(decideRoute(dist, `${PREVIEW_ORIGIN}/`), { kind: 'file', file: path.join(dist, 'index.html'), type: 'text/html; charset=utf-8' })
  assert.equal(decideRoute(dist, `${PREVIEW_ORIGIN}/assets/styles.css`).kind, 'file')
  assert.deepEqual(decideRoute(dist, `${PREVIEW_ORIGIN}/nope.png`), { kind: 'missing' })
  assert.deepEqual(decideRoute(dist, `${PREVIEW_ORIGIN}/..%2f..%2fetc/passwd`), { kind: 'missing' })
  assert.deepEqual(decideRoute(dist, 'https://fonts.googleapis.com/css2?family=X'), { kind: 'block' })
  assert.deepEqual(decideRoute(dist, 'http://fonts.googleapis.com/css2'), { kind: 'block' })
  assert.deepEqual(decideRoute(dist, 'https://tracker.example/pixel.gif'), { kind: 'block' })
  assert.deepEqual(decideRoute(dist, 'http://127.0.0.1:3000/edit'), { kind: 'block' })
})

test('a page is named by slug or by address, in a language', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'name-'))
  initSite(root)
  assert.equal(pagePath(root, 'kontakt'), '/kontakt/')
  assert.equal(pagePath(root, 'kontakt', 'en'), '/en/kontakt/')
  assert.equal(pagePath(root, 'home'), '/')
  assert.equal(pagePath(root, '/kalender/'), '/kalender/')
})

test('a browser finds contrast, sideways scrolling, a missing picture, and hidden words', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  const { auditPage } = await import('./page-audit')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'))
  initSite(root)
  writeLayout(path.join(root, 'design'), {
    name: 'bad',
    purpose: 'A page with problems.',
    slots: { lede: 'text', body: 'markdown', photo: 'image' },
    template:
      '{% extends "shell.njk" %}{% block body %}<section class="hero"><h1>{{ title }}</h1><p class="lede">{{ slots.lede }}</p><div class="wide">{{ labels.wide }}</div></section><div class="hide">{{ slots.body }}</div><img src="{{ slots.photo }}" alt="">{% endblock %}',
    style: '.hero { background: #e7e1d5; padding: 2rem; }\n.lede { color: #ffffff; }\n.wide { width: 700px; background: tomato; }\n.hide { display: none; }\n',
  })
  fs.writeFileSync(path.join(root, 'design', 'labels.yml'), 'wide:\n  de: Breit\n')
  writePage(root, { slug: 'x', layout: 'bad', title: { de: 'X' }, slots: { lede: { de: 'Hell auf hell' }, body: { de: 'Versteckt.' }, photo: '/media/fehlt.jpg' } })
  generate(root)
  const expectations = slotExpectations(root)
  try {
    const mobile = await auditPage(root, '/x/', 'mobile', { expectations, screenshot: 'full' })
    const text = mobile.findings.join('\n')
    assert.match(text, /scrolls sideways at 375px wide .*div\.wide/)
    assert.match(text, /Pictures that did not load: \/media\/fehlt\.jpg/)
    assert.match(text, /Text #ffffff on #e7e1d5 has contrast 1\.3:1/)
    assert.match(text, /not visible: slots\.body/)
    assert.ok(mobile.screenshot && mobile.screenshot.length > 1000)
    assert.equal(mobile.screenshot[0], 0xff)
    const desktop = await auditPage(root, '/x/', 'desktop', { expectations })
    assert.equal(desktop.findings.some((finding) => finding.includes('scrolls sideways')), false)
    const fine = await auditPage(root, '/', 'mobile', { expectations })
    assert.deepEqual(fine.findings, [])
    const missing = await auditPage(root, '/kontakt/', 'desktop', { expectations })
    assert.deepEqual(missing.findings, [])
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})
