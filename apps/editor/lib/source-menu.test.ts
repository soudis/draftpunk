import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, readYaml, writePage, writeYaml } from '@schlor/generator'
import { closeBrowser } from './browser'
import { toolsFor } from './tools'
import { buildNav, MENU_SOURCE, resolverFor, type MenuEntry } from './source-menu'
import { withSitePage } from './web-render'
import { collectPaths } from './site-map'

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file))
const call = { toolCallId: 'menu', messages: [] as never[] }
const origin = 'https://old.example'

const de: MenuEntry[] = [
  { label: 'Über uns', href: `${origin}/ueber-uns/`, children: [{ label: 'Wer wir sind', href: `${origin}/ueber-uns/wer-wir-sind/` }, { label: 'Organisation', href: `${origin}/ueber-uns/organisation/` }] },
  { label: 'Mitmachen', href: `${origin}/mitmachen/`, children: [] },
  { label: 'TRAP', href: 'https://circus-trap.org/', children: [] },
  { label: 'Presse', href: `${origin}/presse/`, children: [] },
]

test('the source menu becomes a menu of this site: pages by address, outbound links kept, the rest listed', () => {
  const pages: Record<string, string> = { '/ueber-uns': '/ueber-uns/', '/ueber-uns/wer-wir-sind': '/wer-wir-sind/', '/mitmachen': '/mitmachen/' }
  const built = buildNav({ de }, { origin, languages: ['de'], resolve: (address) => pages[address] ?? null })
  assert.deepEqual(built.menu, [
    { href: '/ueber-uns/', label: { de: 'Über uns' }, children: [{ href: '/wer-wir-sind/', label: { de: 'Wer wir sind' } }] },
    { href: '/mitmachen/', label: { de: 'Mitmachen' } },
    { href: 'https://circus-trap.org/', label: { de: 'TRAP' } },
  ])
  assert.deepEqual(built.left, ['/ueber-uns/organisation — Organisation', '/presse — Presse'])
  assert.deepEqual(built.copied, [])
})

test('a group whose own page is missing points at its first page, and a group with no page at all is dropped', () => {
  const built = buildNav({ de }, { origin, languages: ['de'], resolve: (address) => (address === '/ueber-uns/organisation' ? '/organisation/' : null) })
  assert.deepEqual(built.menu, [
    { href: '/organisation/', label: { de: 'Über uns' }, children: [{ href: '/organisation/', label: { de: 'Organisation' } }] },
    { href: 'https://circus-trap.org/', label: { de: 'TRAP' } },
  ])
})

test('labels in a second language come from the source only when its menu has the same shape', () => {
  const en: MenuEntry[] = [
    { label: 'About', href: `${origin}/en/about/`, children: [{ label: 'Who we are', href: `${origin}/en/about/who/` }, { label: 'Organisation', href: `${origin}/en/about/org/` }] },
    { label: 'Join', href: `${origin}/en/join/`, children: [] },
    { label: 'TRAP', href: 'https://circus-trap.org/', children: [] },
    { label: 'Press', href: `${origin}/en/press/`, children: [] },
  ]
  const resolve = () => '/x/'
  const same = buildNav({ de, en }, { origin, languages: ['de', 'en'], resolve })
  assert.deepEqual(same.menu[0].label, { de: 'Über uns', en: 'About' })
  assert.deepEqual(same.menu[0].children?.[0].label, { de: 'Wer wir sind', en: 'Who we are' })
  assert.deepEqual(same.copied, [])
  const different = buildNav({ de, en: en.slice(0, 2) }, { origin, languages: ['de', 'en'], resolve })
  assert.deepEqual(different.menu[0].label, { de: 'Über uns', en: 'Über uns' })
  assert.deepEqual(different.copied, ['en'])
})

const SITE = `<!doctype html><html><head><meta charset="utf-8"><title>Alt</title></head><body>
<header><nav><ul>
  <li><a href="/ueber-uns/">Über uns</a><ul><li><a href="/ueber-uns/wer-wir-sind/">Wer wir sind</a></li><li><a href="/ueber-uns/organisation/">Organisation</a></li></ul></li>
  <li><a href="/mitmachen/">Mitmachen</a></li>
  <li><a href="https://circus-trap.org/">TRAP</a></li>
</ul></nav></header><main><h1>Alt</h1><p>Ein Satz.</p><a href="/impressum/">Impressum</a></main>
<footer><nav><ul><li><a href="/datenschutz/">Datenschutz</a></li></ul></nav></footer></body></html>`

test('copy_menu reads the nested menu of a site in a browser and writes it to nav.yml', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-copy-menu-'))
    initSite(root)
    writeYaml(path.join(root, 'design', 'site.yml'), { name: 'Neu', languages: [{ id: 'de', label: 'Deutsch' }] })
    for (const [slug, title] of [['ueber-uns', 'Über uns'], ['wer-wir-sind', 'Wer wir sind'], ['mitmachen', 'Mitmachen']]) {
      writePage(root, { slug, layout: 'article', title: { de: title }, slots: { body: { de: `${title}.` } } })
    }
    writeYaml(path.join(root, 'content', 'sources.yml'), { source: origin, pages: { '/ueber-uns/wer-wir-sind': 'wer-wir-sind' }, pictures: {} })
    const fetchPage = async (url: string) => new Response(SITE, { status: 200, headers: { 'content-type': 'text/html' } })
    // The menu is read from the page itself.
    const entries = await withSitePage(`${origin}/`, { fetchPage }, async (page) => (await page.evaluate((await import('./source-menu')).MENU_SOURCE)) as MenuEntry[])
    assert.deepEqual(entries.map((entry) => [entry.label, entry.children.map((child) => child.label)]), [
      ['Über uns', ['Wer wir sind', 'Organisation']],
      ['Mitmachen', []],
      ['TRAP', []],
    ])
    assert.equal(resolverFor(root)('/ueber-uns/wer-wir-sind'), '/wer-wir-sind/')
    const tools = toolsFor('edit', root, { fetchPage })
    const result = String(await tools.copy_menu.execute!({ source: origin }, call))
    assert.match(result, /The menu now follows https:\/\/old\.example:/)
    assert.match(result, /- Über uns → \/ueber-uns\/ \(Wer wir sind\)/)
    assert.match(result, /Left out, no page on this site: \/ueber-uns\/organisation — Organisation/)
    const nav = readYaml<{ menu: { href: string; children?: { href: string }[] }[]; footer: unknown[] }>(path.join(root, 'design', 'nav.yml'), { menu: [], footer: [] })
    assert.deepEqual(nav.menu.map((item) => item.href), ['/ueber-uns/', '/mitmachen/', 'https://circus-trap.org/'])
    assert.equal(nav.footer.length, 2)
    const home = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8')
    assert.match(home, /class="submenu[^"]*"[\s\S]*Wer wir sind/)
    assert.match(home, /href="https:\/\/circus-trap\.org\/"/)
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})

test('site_map follows the redirect of a front page, and reads the sitemap of the address it ends at', async () => {
  const seen: string[] = []
  const fetchPage = async (url: string) => {
    seen.push(url)
    if (url === 'https://old.example/') return new Response(null, { status: 301, headers: { location: 'https://www.new.example/' } })
    if (url === 'https://www.new.example/') return new Response('<a href="/ueber-uns/">Über uns</a><a href="https://elsewhere.example/">Anderswo</a>', { status: 200, headers: { 'content-type': 'text/html' } })
    if (url === 'https://www.new.example/robots.txt') return new Response('Sitemap: https://www.new.example/sitemap.xml', { status: 200 })
    if (url === 'https://www.new.example/sitemap.xml') return new Response('<urlset><url><loc>https://www.new.example/mitmachen/</loc></url></urlset>', { status: 200 })
    return new Response(null, { status: 404 })
  }
  const found = await collectPaths('https://old.example/', fetchPage as never)
  assert.equal(found.origin, 'https://www.new.example')
  assert.deepEqual(found.paths, ['/mitmachen', '/ueber-uns'])
  assert.equal(found.sitemap, true)
  assert.equal(seen.includes('https://old.example/robots.txt'), false)
})

const THEMED = `<!doctype html><html><head><meta charset="utf-8"><title>Theme</title></head><body>
<header><div class="bar"><ul class="lang"><li><a href="/">de</a></li><li><a href="/en/">en</a></li></ul>
<div class="main"><ul class="menu"><li><a href="/projekt/">Projekt</a><ul class="sub-menu"><li><a href="/projekt/ziele/">Ziele</a></li><li><a href="/projekt/team/">Team</a></li></ul></li><li><a href="/haeuser/">Häuser</a></li><li><a href="/kontakt/">Kontakt</a></li></ul></div>
<div class="phone" style="display:none"><ul class="menu"><li><a href="/projekt/">Projekt</a></li><li><a href="/haeuser/">Häuser</a></li><li><a href="/kontakt/">Kontakt</a></li><li><a href="/extra/">Extra</a></li></ul></div></div></header>
<main><h1>Start</h1><p>Text.</p></main><footer><ul><li><a href="/a/">A</a></li><li><a href="/b/">B</a></li><li><a href="/c/">C</a></li></ul></footer></body></html>`

test('the main menu is found without a nav element, ahead of a language switch, a hidden copy and the footer', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  try {
    const fetchPage = async () => new Response(THEMED, { status: 200, headers: { 'content-type': 'text/html' } })
    const entries = await withSitePage('https://themed.example/', { fetchPage }, async (page) => (await page.evaluate(MENU_SOURCE)) as MenuEntry[])
    assert.deepEqual(entries.map((entry) => [entry.label, entry.children.map((child) => child.label)]), [['Projekt', ['Ziele', 'Team']], ['Häuser', []], ['Kontakt', []]])
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})

test('pages of the first pass, which have names of their own, are found by their last address part or their title', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-resolve-'))
  initSite(root)
  writeYaml(path.join(root, 'design', 'site.yml'), { name: 'Neu', languages: [{ id: 'de', label: 'Deutsch' }] })
  for (const [slug, title] of [['rechtsstruktur', 'Rechtsstruktur'], ['hauser-und-betriebe', 'Betriebe'], ['info-eins', 'Info'], ['info-zwei', 'Info']]) {
    writePage(root, { slug, layout: 'article', title: { de: title }, slots: { body: { de: `${title}.` } } })
  }
  const resolve = resolverFor(root)
  assert.equal(resolve('/ueber-uns/rechtsstruktur', 'Rechtsstruktur'), '/rechtsstruktur/')
  assert.equal(resolve('/unser-grundstueck/betriebe', 'Betriebe'), '/hauser-und-betriebe/')
  assert.equal(resolve('/x/info', 'Info'), null, 'two pages with that title: not guessed')
  assert.equal(resolve('/ueber-uns/finanzierung', 'Finanzierung'), null)
  assert.equal(resolve('/nirgends'), null)
})
