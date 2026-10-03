import assert from 'node:assert/strict'
import test from 'node:test'
import { readSite } from './read-site'
import { assertPublicUrl, extractAppearance, fetchPublicBytes, presentPage, readWebsite } from './read-website'

const publicResolve = async () => [{ address: '93.184.216.34' }]

test('a private or local address is refused', async () => {
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1/secret'), /not a public website/)
  await assert.rejects(() => assertPublicUrl('http://localhost/edit'), /not a public website/)
  await assert.rejects(() => assertPublicUrl('https://user:pw@schlor.org/'), /not a public website/)
  await assert.rejects(() => assertPublicUrl('https://schlor.org:8443/'), /not a public website/)
  await assert.rejects(() => assertPublicUrl('https://intranet.example', async () => [{ address: '10.1.2.3' }]), /not a public website/)
})

test('a public page returns cleaned HTML, absolute links, and colors', async () => {
  const html = `<!doctype html><title>Home &#8226; SchloR</title>
    <script>var secret = "not-in-output"</script>
    <link rel="stylesheet" href="/wp-includes/css/dist/block-library/style.min.css">
    <link rel="stylesheet" href="/wp-content/themes/sydney/css/styles.min.css">
    <style id="global-styles-inline-css">--wp--preset--color--black: #000000;</style>
    <style id="sydney-style-min-inline-css">:root { --sydney-global-color-1:#d65050; --sydney-global-color-6:#317C84; }</style>
    <header><nav><a href="/wohnen/">Wohnen</a><a href="/kalender/">Kalender</a></nav></header>
    <h1>Schöner leben</h1><p>In der Rappachgasse.</p>`
  const css = 'body { font-family: "Source Sans 3", sans-serif; color: #233452; background: #fff; }'
  const fetched: string[] = []
  const page = await readWebsite('https://schlor.org/', async (url) => {
    fetched.push(url)
    if (url.includes('wp-includes')) throw new Error('preset stylesheet should be skipped')
    const body = url.endsWith('.css') ? css : html
    return new Response(body, { status: 200, headers: { 'content-type': url.endsWith('.css') ? 'text/css' : 'text/html' } })
  }, publicResolve)
  assert.deepEqual(fetched, ['https://schlor.org/', 'https://schlor.org/wp-content/themes/sydney/css/styles.min.css'])
  assert.match(page, /<title>Home &#8226; SchloR<\/title>/)
  assert.match(page, /href="https:\/\/schlor.org\/wohnen\/"/)
  assert.match(page, />Wohnen</)
  assert.match(page, /--sydney-global-color-1:#d65050/)
  assert.match(page, /--sydney-global-color-6:#317C84/)
  assert.equal(page.includes('--wp--preset--color--black'), false)
  assert.equal(page.includes('<style'), false)
  assert.equal(page.includes('not-in-output'), false)
  assert.match(page, /font-family: "Source Sans 3", sans-serif/)
  assert.match(page, /Schöner leben/)
})

test('a picture download follows the public website checks', async () => {
  const png = Uint8Array.from([1, 2, 3])
  const saved = await fetchPublicBytes(
    'https://schlor.org/hof.png',
    async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
    publicResolve,
  )
  assert.equal(saved.url, 'https://schlor.org/hof.png')
  assert.deepEqual(saved.body, png)
  await assert.rejects(
    () =>
      fetchPublicBytes(
        'https://schlor.org/hof.png',
        async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/hof.png' } }),
        publicResolve,
      ),
    /not a public website/,
  )
})

test('a redirect onto a private host is refused', async () => {
  await assert.rejects(
    () =>
      readWebsite('https://schlor.org/', async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }), publicResolve),
    /not a public website/,
  )
})

test('appearance extraction keeps colors and type', () => {
  const page = presentPage('https://schlor.org/', '<title>SchloR</title><h1>Haus</h1>', extractAppearance('a{color:#d65050}'))
  assert.match(page, /color:#d65050|color: #d65050/)
  assert.match(page, /<h1>Haus<\/h1>/)
})

test('a picture keeps its largest address', () => {
  const page = presentPage(
    'https://schlor.org/',
    '<img src="/a-400x225.png" srcset="/a-400x225.png 400w, /a-1600x900.png 1600w, /a-768x432.png 768w"><img src="data:image/gif;base64,AAAA" data-src="/full.jpg">',
    '',
  )
  assert.match(page, /src="https:\/\/schlor.org\/a-1600x900.png"/)
  assert.equal(page.includes('400x225'), false)
  assert.equal(page.includes('srcset'), false)
  assert.match(page, /src="https:\/\/schlor.org\/full.jpg"/)
  assert.equal(page.includes('data-src'), false)
})

test('a background picture in a style attribute stays, with an absolute address', () => {
  const page = presentPage('https://schlor.org/', `<div style="background-image: url('/uploads/hof.jpg')"></div>`, '')
  assert.match(page, /url\('https:\/\/schlor.org\/uploads\/hof.jpg'\)/)
})

test('a protected address becomes a mailto link', () => {
  const rot13 = '<p><a href="javascript:;" data-enc-email="genc[at]fpuybe.bet" class="mail-link"><span></span><script>ignored</script><noscript>*protected email*</noscript></a></p>'
  const encoded = '<a href="javascript:;"><script>decodeURIComponent("%63%6f%6e%74%61%63%74%40%73%63%68%6c%6f%72%2e%6f%72%67")</script></a>'
  const key = 0x41
  const address = 'hall@schlor.org'
  const hex = key.toString(16).padStart(2, '0') + [...address].map((char) => (char.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('')
  const cloudflare = `<a href="/cdn-cgi/l/email-protection#${hex}">email</a>`
  const page = presentPage('https://schlor.org/kontakt/', `${rot13}${encoded}${cloudflare}`, '')
  assert.match(page, /href="mailto:trap@schlor.org"/)
  assert.match(page, />trap@schlor.org</)
  assert.match(page, /href="mailto:contact@schlor.org"/)
  assert.match(page, />contact@schlor.org</)
  assert.match(page, /href="mailto:hall@schlor.org"/)
  assert.match(page, />email</)
  assert.equal(page.includes('fpuybe'), false)
  assert.equal(page.includes('protected email'), false)
  assert.equal(page.includes('<script'), false)
})

test('scripts are removed before the page is cut', () => {
  const html = `<script>${'s'.repeat(90_000)}</script><style>${'c'.repeat(1_000)} a{color:#317C84}</style><p>Kontaktseite</p><p>${'x'.repeat(90_000)}</p><p>TAILMARKER</p>`
  const page = presentPage('https://schlor.org/kontakt/', html, '')
  assert.match(page, /Kontaktseite/)
  assert.equal(page.includes('TAILMARKER'), false)
  assert.equal(page.includes('<script'), false)
  assert.equal(page.includes('<style'), false)
  assert.match(page, /color:#317C84/)
  const body = page.split('\n\n')[1] ?? ''
  assert.ok(body.length <= 80_000)
  assert.ok(body.length > 79_000)
})

test('setup reads one page and leaves the next page for another call', async () => {
  const html = '<a href="/kontakt/">Kontakt</a><p>Start</p>'
  const fetched: string[] = []
  const page = await readSite('https://schlor.org/', async (url) => {
    fetched.push(url)
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
  }, publicResolve)
  assert.deepEqual(fetched, ['https://schlor.org/'])
  assert.match(page, /href="https:\/\/schlor.org\/kontakt\/"/)
  assert.match(page, /Start/)
})
