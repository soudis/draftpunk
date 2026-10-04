import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { rewritePreviewUrls, siteDecision, toPreviewPath } from './site-route'
import { serveGenerated } from './site-serve'

test('visitors get the published site, and the draft stays behind the preview', () => {
  assert.deepEqual(siteDecision('/', false), { type: 'rewrite', pathname: '/api/site/index.html' })
  assert.deepEqual(siteDecision('/', true), { type: 'rewrite', pathname: '/api/site/index.html' })
  assert.deepEqual(siteDecision('/wohnen/', true), { type: 'rewrite', pathname: '/api/site/wohnen/index.html' })
  assert.deepEqual(siteDecision('/preview/', false), { type: 'login' })
  assert.deepEqual(siteDecision('/preview/wohnen/', true), { type: 'rewrite', pathname: '/api/preview/wohnen/index.html' })
  assert.deepEqual(siteDecision('/edit', false), { type: 'login' })
  assert.deepEqual(siteDecision('/api/chat', false), { type: 'login' })
  assert.deepEqual(siteDecision('/api/preview/index.html', false), { type: 'login' })
  assert.deepEqual(siteDecision('/api/site/index.html', false), { type: 'next' })
  assert.deepEqual(siteDecision('/edit', true), { type: 'next' })
})

test('preview links stay in the preview', () => {
  const html = '<a href="/wohnen/">Wohnen</a><img src="/media/hof.jpg" srcset="/media/hof.jpg 800w, /media/hof-400.jpg 400w"><link rel="stylesheet" href="/assets/styles.css">'
  const rewritten = rewritePreviewUrls(html)
  assert.match(rewritten, /href="\/preview\/wohnen\/"/)
  assert.match(rewritten, /src="\/preview\/media\/hof.jpg"/)
  assert.match(rewritten, /\/preview\/media\/hof-400.jpg 400w/)
  assert.match(rewritten, /href="\/preview\/assets\/styles.css"/)
  assert.equal(rewritePreviewUrls(' <a href="/">Home</a>'), ' <a href="/preview/">Home</a>')
  assert.equal(rewritePreviewUrls(' data-href="/events/quiz/"'), ' data-href="/preview/events/quiz/"')
  assert.equal(rewritePreviewUrls(' href="https://schlor.org/wohnen/"'), ' href="https://schlor.org/wohnen/"')
  assert.equal(rewritePreviewUrls('url(/preview/assets/styles.css)'), 'url(/preview/assets/styles.css)')
  assert.equal(rewritePreviewUrls('url(/media/hof.jpg)'), 'url(/preview/media/hof.jpg)')
  const css = '/*! tailwind */ :root { --h: calc(1 / 0.75); } .card { box-shadow: 0 1px rgb(0 0 0 / 0.1); grid-column: span 5 / span 5; }'
  assert.equal(rewritePreviewUrls(css), css)
  assert.equal(rewritePreviewUrls('if (/party|fest/.test(key)) {} <rect height="18"/>'), 'if (/party|fest/.test(key)) {} <rect height="18"/>')
  assert.equal(toPreviewPath('/'), '/preview/')
  assert.equal(toPreviewPath('/wohnen/'), '/preview/wohnen/')
  assert.equal(toPreviewPath('/preview/wohnen/'), '/preview/wohnen/')
})

test('a published file is served as itself, and a draft file is served only from the preview', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-serve-'))
  const published = path.join(root, 'published')
  const draft = path.join(root, 'dist')
  fs.mkdirSync(published)
  fs.mkdirSync(draft)
  fs.writeFileSync(path.join(published, 'index.html'), '<a href="/wohnen/">Public</a>')
  fs.writeFileSync(path.join(draft, 'index.html'), '<a href="/wohnen/">Draft</a>')
  const live = await serveGenerated(published, 'index.html', false).text()
  const preview = await serveGenerated(draft, 'index.html', true).text()
  assert.match(live, /href="\/wohnen\/"/)
  assert.match(live, /Public/)
  assert.match(preview, /href="\/preview\/wohnen\/"/)
  assert.match(preview, /Draft/)
  const missing = serveGenerated(path.join(root, 'empty'), '', false)
  assert.equal(missing.status, 404)
  assert.match(await missing.text(), /has not been published/)
})
