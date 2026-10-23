import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generate, initSite, writeYaml } from '@schlor/generator'
import { closeBrowser } from './browser'

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file))

function plainSite(html: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-'))
  fs.mkdirSync(path.join(root, 'dist'))
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), html)
  return root
}

const page = (menu: string, style: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Menü</title><style>body{font:16px sans-serif;margin:0}nav{display:flex;gap:24px;padding:16px}${style}</style></head><body><header><nav>${menu}</nav></header><main><h1>Willkommen</h1><p>Ein Satz, der lang genug ist, damit die Seite nicht leer wirkt.</p></main></body></html>`

test('a menu whose sub-entries never show is reported, one that opens on hover or focus is not', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  const { auditPage } = await import('./page-audit')
  try {
    // A link inside a summary: hovering does nothing, and a click goes to the group's page. This is the case from the first real setup.
    const stuck = plainSite(
      page(
        '<a href="/">Start</a><details><summary><a href="/raeume/">Räume</a></summary><ul><li><a href="/crap/">CRAP</a></li><li><a href="/trap/">TRAP</a></li></ul></details>',
        'details:not([open]) ul{display:none}',
      ),
    )
    const found = (await auditPage(stuck, '/', 'desktop')).findings
    assert.equal(found.length, 1)
    assert.match(found[0], /menu entry “Räume” \(CRAP, TRAP\) stay hidden when the entry is hovered or focused/)

    const hover = plainSite(
      page(
        '<a href="/">Start</a><div class="g"><a href="/raeume/">Räume</a><ul class="s"><li><a href="/crap/">CRAP</a></li></ul></div>',
        '.g{position:relative}.s{position:absolute;top:100%;opacity:0;pointer-events:none;list-style:none;margin:0;padding:8px;background:#fff}.g:hover .s,.g:focus-within .s{opacity:1;pointer-events:auto}',
      ),
    )
    assert.deepEqual((await auditPage(hover, '/', 'desktop')).findings, [])

    const keyboardOnly = plainSite(
      page(
        '<div class="g"><a href="/raeume/">Räume</a><ul class="s"><li><a href="/crap/">CRAP</a></li></ul></div>',
        '.g{position:relative}.s{position:absolute;top:100%;opacity:0;list-style:none;margin:0}.g:focus-within .s{opacity:1}',
      ),
    )
    assert.match((await auditPage(keyboardOnly, '/', 'desktop')).findings.join(' '), /open on keyboard focus but not when the entry is hovered/)

    // A button that opens its list on a click is a menu too.
    const button = plainSite(
      page(
        '<div><button onclick="this.nextElementSibling.hidden=false">Räume</button><ul hidden><li><a href="/crap/">CRAP</a></li></ul></div>',
        '',
      ),
    )
    assert.deepEqual((await auditPage(button, '/', 'desktop')).findings, [])

    // A menu with nothing hidden, and a hidden link next to shown ones that is no sub-entry, are left alone.
    const flat = plainSite(page('<a href="/">Start</a><a href="/kontakt/">Kontakt</a><a href="/x/" style="display:none">Nie</a>', ''))
    assert.deepEqual((await auditPage(flat, '/', 'desktop')).findings, [])
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})

test('the starter menu opens its groups on hover and keyboard focus', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  const { auditPage } = await import('./page-audit')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-menu-'))
  initSite(root)
  writeYaml(path.join(root, 'design', 'nav.yml'), {
    menu: [
      { href: '/', label: { de: 'Start', en: 'Home' } },
      {
        href: '/kontakt/',
        label: { de: 'Über uns', en: 'About' },
        children: [
          { href: '/impressum/', label: { de: 'Wer wir sind', en: 'Who we are' } },
          { href: '/datenschutz/', label: { de: 'Organisation', en: 'Organisation' } },
        ],
      },
    ],
    footer: [],
  })
  generate(root)
  try {
    const desktop = await auditPage(root, '/', 'desktop')
    assert.deepEqual(desktop.findings.filter((finding) => finding.includes('menu entry')), [])
    const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8')
    assert.match(html, /class="menu-group"[\s\S]*class="submenu[^"]*"[\s\S]*Wer wir sind/)
    assert.equal(html.includes('<summary'), false)
    // The check is not blind to this menu: with the hover rule undone, the same page is reported.
    // The pages link the stylesheet by the name its content gives it.
    const css = path.join(root, 'dist', 'assets', fs.readdirSync(path.join(root, 'dist', 'assets')).find((name) => /^styles\.[0-9a-f]{10}\.css$/.test(name)) as string)
    fs.appendFileSync(css, '\n.menu-group:hover > .submenu,.menu-group:focus-within > .submenu{opacity:0 !important}\n')
    const broken = await auditPage(root, '/', 'desktop')
    assert.match(broken.findings.join(' '), /menu entry “Über uns” \(Wer wir sind, Organisation\) stay hidden/)
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})
