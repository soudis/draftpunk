import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPublicUrl, extractAppearance, fetchPublicBytes, readWebsite, summarizePage } from './read-website'

const publicResolve = async () => [{ address: '93.184.216.34' }]

test('a private or local address is refused', async () => {
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1/secret'), /not a public website/)
  await assert.rejects(() => assertPublicUrl('http://localhost/edit'), /not a public website/)
  await assert.rejects(() => assertPublicUrl('https://user:pw@schlor.org/'), /not a public website/)
  await assert.rejects(() => assertPublicUrl('https://schlor.org:8443/'), /not a public website/)
  await assert.rejects(() => assertPublicUrl('https://intranet.example', async () => [{ address: '10.1.2.3' }]), /not a public website/)
})

test('a public page returns its title, links, and colors', async () => {
  const html = `<!doctype html><title>Home &#8226; SchloR</title>
    <link rel="stylesheet" href="/wp-includes/css/dist/block-library/style.min.css">
    <link rel="stylesheet" href="/wp-content/themes/sydney/css/styles.min.css">
    <style id="global-styles-inline-css">--wp--preset--color--black: #000000;</style>
    <style id="sydney-style-min-inline-css">:root { --sydney-global-color-1:#d65050; --sydney-global-color-6:#317C84; }</style>
    <header><nav><a href="/wohnen/">Wohnen</a><a href="/kalender/">Kalender</a></nav></header>
    <h1>Schöner leben</h1><p>In der Rappachgasse.</p>`
  const css = 'body { font-family: "Source Sans 3", sans-serif; color: #233452; background: #fff; }'
  const fetched: string[] = []
  const summary = await readWebsite('https://schlor.org/', async (url) => {
    fetched.push(url)
    if (url.includes('wp-includes')) throw new Error('preset stylesheet should be skipped')
    const body = url.endsWith('.css') ? css : html
    return new Response(body, { status: 200, headers: { 'content-type': url.endsWith('.css') ? 'text/css' : 'text/html' } })
  }, publicResolve)
  assert.deepEqual(fetched, ['https://schlor.org/', 'https://schlor.org/wp-content/themes/sydney/css/styles.min.css'])
  assert.match(summary, /Title: Home • SchloR/)
  assert.match(summary, /Wohnen → \/wohnen\//)
  assert.match(summary, /--sydney-global-color-1:#d65050/)
  assert.match(summary, /--sydney-global-color-6:#317C84/)
  assert.equal(summary.includes('--wp--preset--color--black'), false)
  assert.match(summary, /font-family: "Source Sans 3", sans-serif/)
  assert.match(summary, /Schöner leben/)
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
  const summary = summarizePage('https://schlor.org/', '<title>SchloR</title><h1>Haus</h1>', extractAppearance('a{color:#d65050}'))
  assert.match(summary, /color:#d65050|color: #d65050/)
  assert.match(summary, /Haus/)
})
