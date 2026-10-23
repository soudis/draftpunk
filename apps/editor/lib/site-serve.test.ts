import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { rewritePreviewUrls, siteDecision, toPreviewPath } from './site-route'
import zlib from 'node:zlib'
import { chooseEncoding, serveGenerated } from './site-serve'

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

test('the encoding is the best one the browser accepts, and none when it accepts neither', () => {
  assert.equal(chooseEncoding('gzip, deflate, br, zstd'), 'br')
  assert.equal(chooseEncoding('gzip, deflate'), 'gzip')
  assert.equal(chooseEncoding('br;q=0, gzip'), 'gzip')
  assert.equal(chooseEncoding('gzip;q=0'), null)
  assert.equal(chooseEncoding('identity'), null)
  assert.equal(chooseEncoding('*'), 'br')
  assert.equal(chooseEncoding(null), null)
})

test('the public site sends text compressed, with a validator, and the right type for every kind of file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-gzip-'))
  const html = `<html>${'<p>Wohnen im Hof, gemeinsam und laut.</p>'.repeat(100)}</html>`
  fs.writeFileSync(path.join(root, 'index.html'), html)
  fs.writeFileSync(path.join(root, 'robots.txt'), 'User-agent: *\n'.repeat(80))
  fs.writeFileSync(path.join(root, 'sitemap.xml'), '<urlset>' + '<url><loc>https://x.org/a/</loc></url>'.repeat(40) + '</urlset>')
  fs.writeFileSync(path.join(root, 'tiny.css'), 'a{}')
  fs.mkdirSync(path.join(root, 'media'))
  fs.writeFileSync(path.join(root, 'media', 'hof.png'), Buffer.alloc(5000, 7))
  const ask = (file: string, accept?: string, extra: Record<string, string> = {}) =>
    serveGenerated(root, file, false, new Request('http://x.test/' + file, { headers: { ...(accept ? { 'accept-encoding': accept } : {}), ...extra } }))

  const gzipped = ask('index.html', 'gzip')
  assert.equal(gzipped.headers.get('content-encoding'), 'gzip')
  assert.equal(gzipped.headers.get('vary'), 'Accept-Encoding')
  assert.equal(zlib.gunzipSync(Buffer.from(await gzipped.arrayBuffer())).toString(), html)
  const brotli = ask('index.html', 'gzip, br')
  assert.equal(brotli.headers.get('content-encoding'), 'br')
  assert.equal(zlib.brotliDecompressSync(Buffer.from(await brotli.arrayBuffer())).toString(), html)
  assert.ok(Number(brotli.headers.get('content-length')) < html.length / 5)
  // A browser that accepts nothing gets the file as it is.
  const plain = ask('index.html')
  assert.equal(plain.headers.get('content-encoding'), null)
  assert.equal(await plain.text(), html)

  // The validator makes the second visit cheap, and differs per encoding.
  const etag = gzipped.headers.get('etag') as string
  assert.notEqual(etag, brotli.headers.get('etag'))
  assert.equal(ask('index.html', 'gzip', { 'if-none-match': etag }).status, 304)
  assert.equal(ask('index.html', 'br', { 'if-none-match': etag }).status, 200)

  // The type is the file's own, not a download.
  assert.match(ask('robots.txt').headers.get('content-type') ?? '', /^text\/plain/)
  assert.match(ask('sitemap.xml').headers.get('content-type') ?? '', /^application\/xml/)
  // A small file and a picture are not compressed; a picture may be kept for a day.
  assert.equal(ask('tiny.css', 'gzip').headers.get('content-encoding'), null)
  const picture = ask('media/hof.png', 'gzip, br')
  assert.equal(picture.headers.get('content-encoding'), null)
  assert.equal(picture.headers.get('cache-control'), 'public, max-age=86400')
  assert.equal(ask('index.html', 'gzip').headers.get('cache-control'), 'no-cache')
})

test('the preview is never compressed or kept', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-gzip-preview-'))
  fs.writeFileSync(path.join(root, 'index.html'), '<p>x</p>'.repeat(300))
  const response = serveGenerated(root, 'index.html', true, new Request('http://x.test/', { headers: { 'accept-encoding': 'gzip, br' } }))
  assert.equal(response.headers.get('content-encoding'), null)
  assert.equal(response.headers.get('cache-control'), 'no-cache')
})

test('a page has one address, a missing page shows the 404 page of its language, and a file carries its protections', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-address-'))
  const script = "document.documentElement.classList.add('js');"
  fs.mkdirSync(path.join(root, 'kontakt'))
  fs.mkdirSync(path.join(root, 'en'))
  fs.mkdirSync(path.join(root, 'assets'))
  fs.mkdirSync(path.join(root, 'media', '_sizes'), { recursive: true })
  fs.writeFileSync(path.join(root, 'index.html'), '<p>home</p>')
  fs.writeFileSync(path.join(root, 'kontakt', 'index.html'), `<script>${script}</script><script type="application/ld+json">{"a":1}</script><script src="/x.js"></script><p>Kontakt</p>`)
  fs.writeFileSync(path.join(root, '404.html'), '<p>Seite nicht gefunden</p>')
  fs.writeFileSync(path.join(root, 'en', '404.html'), '<p>Page not found</p>')
  fs.writeFileSync(path.join(root, 'assets', 'styles.0123456789.css'), 'a{}')
  fs.writeFileSync(path.join(root, 'media', '_sizes', 'hof-480-abcdef12.webp'), 'x')
  const ask = (rel: string, url = `http://x.test/${rel}`) => serveGenerated(root, rel, false, new Request(url))

  const bare = ask('kontakt', 'http://x.test/kontakt?a=1')
  assert.equal(bare.status, 308)
  assert.equal(bare.headers.get('location'), '/kontakt/?a=1')
  assert.equal(ask('kontakt/index.html').status, 200)

  const german = ask('gibts-nicht/index.html')
  assert.equal(german.status, 404)
  assert.match(await german.text(), /Seite nicht gefunden/)
  const english = ask('en/gibts-nicht/index.html')
  assert.equal(english.status, 404)
  assert.match(await english.text(), /Page not found/)
  const picture = ask('media/missing.jpg')
  assert.equal(picture.status, 404)
  assert.match(picture.headers.get('content-type') ?? '', /^text\/plain/)

  const page = ask('kontakt/index.html')
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  const policy = page.headers.get('content-security-policy') ?? ''
  assert.match(policy, /default-src 'self'/)
  assert.ok(policy.includes(`'sha256-${crypto.createHash('sha256').update(script).digest('base64')}'`), 'the page script is named by its hash')
  assert.equal(policy.includes('unsafe-inline') && /script-src[^;]*unsafe-inline/.test(policy), false)
  assert.equal((policy.match(/sha256-/g) ?? []).length, 1, 'a data block and a script file are not scripts to allow')
  assert.equal(ask('assets/styles.0123456789.css').headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(ask('media/_sizes/hof-480-abcdef12.webp').headers.get('cache-control'), 'public, max-age=31536000, immutable')
})
