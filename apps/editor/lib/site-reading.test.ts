import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite } from '@schlor/generator'
import { closeBrowser } from './browser'
import { cached } from './web-cache'
import { hostOf, listReferences, readReference, saveReference } from './references'
import { internalLinks, parseSitemap, siteMap, summarizePaths } from './site-map'
import { formatProfile, type RawProfile } from './site-profile'
import { formatText } from './site-text'
import { toolsFor } from './tools'
import { withSitePage } from './web-render'

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file))
const call = { toolCallId: 'site', messages: [] as never[] }

const raw: RawProfile = {
  title: 'SchloR',
  lang: 'de',
  themeColor: '#317c84',
  pageBg: '#ffffff',
  text: [{ color: '#233452', share: 0.8 }],
  headingColors: { h1: { color: '#ffffff', on: '#317c84' }, h2: { color: '#317c84', on: '#ffffff' } },
  linkColor: '#d65050',
  areas: [{ color: '#ffffff', share: 0.6 }, { color: '#317c84', share: 0.25 }, { color: '#f3cb64', share: 0.01 }],
  headerBg: '#ffffff',
  footerBg: '#f3cb64',
  buttons: [{ bg: '#d65050', color: '#ffffff', radius: 4, text: 'Mitmachen' }],
  fonts: {
    body: { family: 'Roboto', size: 16, weight: '400', lineHeight: '1.6', transform: 'none', spacing: '' },
    h1: { family: 'Roboto Slab', size: 44, weight: '700', lineHeight: '1.2', transform: 'none', spacing: '' },
    nav: { family: 'Roboto', size: 14, weight: '700', lineHeight: '1.2', transform: 'uppercase', spacing: '0.7px' },
  },
  faces: ['Roboto', 'Roboto Slab'],
  buttonRadius: 4,
  cardRadius: 8,
  shadows: true,
  contentWidth: 1100,
  sectionGap: 64,
  nav: { links: [{ text: 'Über uns', href: 'https://x.org/ueber/' }, { text: 'Kontakt', href: 'https://x.org/kontakt/' }], dropdowns: true, logo: 'https://x.org/logo.png' },
  heroImage: 'https://x.org/hero.jpg',
  sections: [
    { tag: 'header', height: 90, bg: '#ffffff', heading: '', images: 1, headings: 0, buttons: 0, paragraphs: 0, links: 6, repeat: 6 },
    { tag: 'section', height: 520, bg: '#317c84', heading: 'Schöner leben', images: 1, headings: 1, buttons: 1, paragraphs: 1, links: 1, repeat: 1 },
    { tag: 'section', height: 300, bg: '#ffffff', heading: 'Betriebe', images: 3, headings: 3, buttons: 0, paragraphs: 3, links: 3, repeat: 3 },
    { tag: 'section', height: 260, bg: '#233452', heading: 'Direktkredite', images: 0, headings: 1, buttons: 1, paragraphs: 1, links: 1, repeat: 1 },
    { tag: 'footer', height: 120, bg: '#f3cb64', heading: '', images: 0, headings: 0, buttons: 0, paragraphs: 1, links: 3, repeat: 3 },
  ],
}

test('a profile names colors by role, type, shape, and the sections in order', () => {
  const text = formatProfile('https://www.x.org/', raw)
  assert.match(text, /^# x\.org\nSchloR \(de\), theme color #317c84\n/)
  assert.match(text, /Colors: page #ffffff; text #233452; headings h1 #ffffff on #317c84, h2 #317c84; links #d65050; header #ffffff; footer #f3cb64\./)
  assert.match(text, /Buttons: #d65050 with #ffffff text \(“Mitmachen”\)\./)
  assert.match(text, /Other large color areas: #317c84 \(25%\)\./)
  assert.match(text, /Type: body Roboto 16px, line 1\.6; h1 Roboto Slab 44px 700; nav Roboto 14px 700, uppercase 0\.7px\./)
  assert.match(text, /Shape: button corners 4px, card and picture corners 8px, cards have shadows, content up to 1100px wide, sections have about 64px of padding above\./)
  assert.match(text, /Menu: Über uns · Kontakt \(with drop-down menus\)\. Logo: https:\/\/x\.org\/logo\.png/)
  assert.match(text, /1\. header, page color, 90px, 1 picture\n2\. hero, #317c84, 520px, “Schöner leben”, 1 picture, 1 button\n3\. 3 cards, page color, 300px, “Betriebe”\n4\. call to action, #233452, 260px, “Direktkredite”, 1 button\n5\. footer, #f3cb64, 120px/)
  assert.ok(text.length / 3.5 < 650)
  assert.throws(() => formatProfile('https://x.org/', { empty: true } as never), /shows nothing to read/)
})

test('page text keeps its headings and says when there is none', () => {
  assert.equal(formatText('https://x.org/a', { title: 'A', markdown: '# A\n\nText.', headings: [] }), 'URL: https://x.org/a\nTitle: A\n\n# A\n\nText.')
  assert.throws(() => formatText('https://x.org/a', { title: '', markdown: ' ', headings: [] }), /shows no text to read/)
})

test('links to the same site are listed once, with their words', () => {
  const html = `<a href="/ueber-uns/">Über <b>uns</b></a><a href="https://www.x.org/ueber-uns/#team">Team</a><a href="/kontakt">Kontakt</a>
    <a href="https://other.org/">Draussen</a><a href="mailto:a@x.org">Mail</a><a href="/media/a.pdf">PDF</a><a href="#top">Oben</a><a href="/"><img src="l.png"></a>`
  assert.deepEqual(internalLinks(html, 'https://x.org/'), [
    { path: '/ueber-uns', label: 'Über uns' },
    { path: '/kontakt', label: 'Kontakt' },
    { path: '/', label: '' },
  ])
})

test('a sitemap lists pages, and a long one is grouped', () => {
  assert.deepEqual(parseSitemap('<urlset><url><loc>https://x.org/a/</loc></url><url><loc>https://x.org/b/?x=1&amp;y=2</loc></url></urlset>'), { pages: ['https://x.org/a/', 'https://x.org/b/?x=1&y=2'], sitemaps: [] })
  assert.deepEqual(parseSitemap('<sitemapindex><sitemap><loc>https://x.org/s1.xml</loc></sitemap></sitemapindex>'), { pages: [], sitemaps: ['https://x.org/s1.xml'] })
  const many = [...Array.from({ length: 90 }, (_v, i) => `/news/post-${i}`), '/kontakt', '/ueber']
  const lines = summarizePaths(many)
  assert.ok(lines.length < 10)
  assert.match(lines[0], /^\/news\/… \(90 pages, for example \/news\/post-0, \/news\/post-1\)$/)
  assert.ok(lines.includes('/kontakt'))
})

test('site_map reads the front page and the sitemap, and says when there is none', async () => {
  const pages: Record<string, string> = {
    'https://x.org/': '<a href="/wohnen/">Wohnen</a><a href="/crap/">CRAP</a>',
    'https://x.org/robots.txt': 'User-agent: *\nSitemap: https://x.org/sitemap_index.xml\n',
    'https://x.org/sitemap_index.xml': '<sitemapindex><sitemap><loc>https://x.org/p.xml</loc></sitemap></sitemapindex>',
    'https://x.org/p.xml': '<urlset><url><loc>https://x.org/wohnen/</loc></url><url><loc>https://x.org/crap/ateliers/</loc></url></urlset>',
  }
  const fetchPage = async (url: string) => (pages[url] ? new Response(pages[url], { status: 200 }) : new Response('', { status: 404 }))
  const map = await siteMap('x.org', fetchPage)
  assert.match(map, /Links on https:\/\/x\.org\/ to the same site \(2\):\n- \/wohnen — Wohnen\n- \/crap — CRAP/)
  assert.match(map, /Sitemap lists 2 pages:\n- \/crap\/ateliers\n- \/wohnen/)
  await assert.rejects(() => siteMap('x.org', async () => new Response('', { status: 404 })), /Could not read/)
  const none = await siteMap('x.org', async (url) => (url === 'https://x.org/' ? new Response('<p>hi</p>', { status: 200 }) : new Response('', { status: 404 })))
  assert.match(none, /No sitemap was found\./)
})

test('a site is kept as a reference with what the person likes, and listed for later chats', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-ref-'))
  initSite(root)
  assert.equal(hostOf('https://www.Syndikat.org/de/'), 'syndikat.org')
  const host = saveReference(root, { url: 'https://www.syndikat.org/de/', note: 'The calm header, but not the red.', profile: '# syndikat.org\nColors: page #fff.' }, new Date('2026-10-22T10:00:00Z'))
  assert.equal(host, 'syndikat.org')
  assert.equal(readReference(root, 'https://syndikat.org'), '# syndikat.org\nSource: https://www.syndikat.org/de/\nSaved: 2026-10-22\nNote: The calm header, but not the red.\n\nColors: page #fff.\n')
  assert.deepEqual(listReferences(root), [{ host: 'syndikat.org', note: 'The calm header, but not the red.', saved: '2026-10-22' }])
  assert.throws(() => readReference(root, 'other.org'), /No saved reference for other\.org\. Saved: syndikat\.org/)
  assert.throws(() => hostOf('http://'), /not a web address/)
})

test('what a site said is kept for a while and then read again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-cache-'))
  let runs = 0
  const compute = async () => `run ${++runs}`
  assert.equal(await cached(dir, 'a', compute, 1000, 0), 'run 1')
  assert.equal(await cached(dir, 'a', compute, 1000, 500), 'run 1')
  assert.equal(await cached(dir, 'a', compute, 1000, 2000), 'run 2')
  assert.equal(await cached(dir, 'b', compute, 1000, 2000), 'run 3')
  assert.equal(await cached(undefined, 'a', compute), 'run 4')
})

const SITE = `<!doctype html><html lang="de"><head><title>Wohnen · Beispiel</title><style>
body{margin:0;font:16px/1.6 Georgia,serif;color:#233452;background:#f4f5f7}
header{background:#fff;padding:16px 32px}nav a{margin-right:16px;font:700 14px Arial;color:#233452}
.hero{background:#317c84;color:#fff;padding:80px 32px;min-height:360px}.hero h1{font:700 44px Arial;margin:0}
.btn{display:inline-block;background:#d65050;color:#fff;padding:12px 24px;border-radius:4px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:1100px;margin:0 auto;padding:48px 32px}.card{background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.2);padding:20px}
footer{background:#d65050;color:#fff;padding:24px}.cookie{position:fixed;inset:0;background:#000c;color:#fff}
</style></head><body>
<div class="cookie"><p>Wir verwenden Cookies. Alles akzeptieren.</p></div>
<header><nav><a href="/wohnen/">Wohnen</a><a href="/kontakt/">Kontakt</a></nav></header>
<main><section class="hero"><h1>Schöner leben</h1><a class="btn" href="/mitmachen/">Mitmachen</a></section>
<article><h2>Unser Haus</h2><p>Wir wohnen <strong>gemeinsam</strong> und schreiben an <a id="mail">hier</a>.</p><ul><li>Hof</li><li>Werkstatt</li></ul>
<img src="/foto.jpg" width="400" height="200" alt="Der Hof"><p>Ende.</p></article>
<section><div class="cards"><div class="card"><h3>A</h3><p>x</p></div><div class="card"><h3>B</h3><p>y</p></div><div class="card"><h3>C</h3><p>z</p></div></div></section></main>
<footer><p>© Beispiel</p></footer>
<script>document.getElementById('mail').href='mailto:' + ['haus','example.org'].join('@');document.getElementById('mail').textContent='haus@example.org'</script>
</body></html>`

function serve(): Promise<{ url: string; close: () => void; seen: string[] }> {
  const seen: string[] = []
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      seen.push(request.url ?? '')
      if (request.url === '/foto.jpg') {
        response.writeHead(200, { 'content-type': 'image/svg+xml' })
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#999"/></svg>')
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(SITE)
    })
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close(), seen }))
  })
}

// A test site is on this machine, so the test reaches it with a fetch that allows that. The real one would refuse.
const localFetch = (url: string, init: RequestInit) => fetch(url, { ...init, redirect: 'manual' })

test('the real fetch refuses a private address before the browser is opened', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  try {
    await assert.rejects(() => withSitePage('http://127.0.0.1:8080/', {}, async () => 'x'), /not a public website/)
    await assert.rejects(() => withSitePage('http://localhost/', {}, async () => 'x'), /not a public website/)
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})

test('a site is read in a browser: its look, its words, a kept reference, and a request that leaves is stopped', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  const site = await serve()
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-site-read-'))
    initSite(root)
    const cacheDir = path.join(root, '..', `cache-${path.basename(root)}`)
    const tools = toolsFor('edit', root, { fetchPage: localFetch, cacheDir })
    assert.equal('read_website' in tools, false)
    const profile = String(await tools.inspect_website.execute!({ url: `${site.url}/` }, call))
    assert.match(profile, /Beispiel|Wohnen · Beispiel \(de\)/)
    assert.match(profile, /Colors: page #f4f5f7; text #233452;/)
    assert.match(profile, /Buttons: #d65050 with #ffffff text \(“Mitmachen”\)/)
    assert.match(profile, /Type: body Georgia 16px/)
    assert.match(profile, /button corners 4px, card and picture corners 8px, cards have shadows, content up to 1100px wide/)
    assert.match(profile, /Menu: Wohnen · Kontakt/)
    assert.match(profile, /hero, #317c84/)
    assert.match(profile, /3 cards/)
    const requestsBefore = site.seen.length
    assert.equal(String(await tools.inspect_website.execute!({ url: `${site.url}/` }, call)), profile)
    assert.equal(site.seen.length, requestsBefore)

    const text = String(await tools.read_page_text.execute!({ url: `${site.url}/` }, call))
    assert.match(text, /^URL: http:\/\/127\.0\.0\.1:\d+\/\nTitle: Wohnen · Beispiel\n\n# Schöner leben/)
    assert.match(text, /## Unser Haus\n\nWir wohnen \*\*gemeinsam\*\* und schreiben an \[haus@example\.org\]\(mailto:haus@example\.org\)\./)
    assert.match(text, /- Hof\n- Werkstatt/)
    assert.match(text, /!\[Der Hof\]\(http:\/\/127\.0\.0\.1:\d+\/foto\.jpg\)/)
    assert.equal(text.includes('Cookies'), false)
    assert.equal(text.includes('© Beispiel'), false)
    assert.equal(text.includes('Kontakt'), false)

    const saved = String(await tools.save_reference.execute!({ url: `${site.url}/`, note: 'Likes the teal hero and the three cards.' }, call))
    assert.match(saved, /Saved design\/references\/127\.0\.0\.1\.md\./)
    assert.match(String(await tools.read_reference.execute!({ site: '127.0.0.1' }, call)), /Note: Likes the teal hero and the three cards\.\n\nWohnen · Beispiel \(de\)\nColors: page #f4f5f7/)
    await assert.rejects(() => tools.inspect_website.execute!({ url: 'http://localhost:9/' }, call), /Could not read http:\/\/localhost:9\/: it could not be reached/)
  } finally {
    await closeBrowser()
    site.close()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})
