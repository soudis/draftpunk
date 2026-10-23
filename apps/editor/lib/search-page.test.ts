import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generate, initSite, writePage } from '@schlor/generator'
import { decideRoute, getBrowser, PREVIEW_ORIGIN, closeBrowser } from './browser'

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file))

test('the search page finds words with umlauts and ß, lists posts and events, and the header field leads to it', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-search-'))
    initSite(root)
    writePage(root, { slug: 'werkstatt', layout: 'article', title: { de: 'Werkstatt', en: 'Workshop' }, slots: { body: { de: 'Hier wird gelötet und gesägt. Die Straße ist ruhig, die Türen sind offen.', en: 'We solder and saw here.' } } })
    writePage(root, { slug: 'dach', layout: 'article', date: '2025-03-04', title: { de: 'Neues Dach', en: 'New roof' }, slots: { body: { de: 'Das Dach ist fertig. Danke an alle, die geholfen haben.', en: 'The roof is done.' } } })
    fs.mkdirSync(path.join(root, 'content', 'events'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'content', 'events', 'fest.yml'),
      ['slug: fest', 'title:', '  de: Sommerfest', '  en: Summer party', 'body:', '  de: Grillen im Hof mit Musik.', 'place: haus', 'categories: []', 'dates:', '  - start: 2031-07-05T16:00:00.000Z'].join('\n'),
    )
    generate(root)
    const dist = path.join(root, 'dist')
    const context = await (await getBrowser()).newContext({ viewport: { width: 1000, height: 800 } })
    await context.route('**/*', async (route) => {
      const decision = decideRoute(dist, route.request().url())
      if (decision.kind === 'file') return route.fulfill({ status: 200, contentType: decision.type, body: fs.readFileSync(decision.file) })
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
    })
    const page = await context.newPage()
    const results = async () => (await page.$$eval('[data-results] li', (items) => items.map((item) => ((item as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim()))) as string[]
    const settle = async () => {
      await page.waitForFunction("document.querySelector('[data-status]').textContent.length > 0", undefined, { timeout: 5_000 })
    }
    // The first result is the one whose title is asked for (a title ranks before a word in the text).
    const showing = async (title: string) => {
      await page.waitForFunction((wanted) => document.querySelector('[data-results] li a')?.textContent === wanted, title, { timeout: 5_000 })
    }
    // A search with umlauts, folded: strasse finds Straße, turen finds Türen.
    await page.goto(`${PREVIEW_ORIGIN}/suche/?q=strasse%20turen`)
    await settle()
    let found = await results()
    assert.equal(found.length, 1)
    assert.match(found[0], /^WerkstattSeiteHier wird gelötet und gesägt\. Die Straße ist ruhig, die Türen sind offen\./)
    assert.equal(found[0].includes('|'), false, 'a mark of the preview is in the text')
    assert.equal(await page.textContent('[data-status]'), '1 Treffer')
    // A post and an event are found, and say what they are.
    await page.fill('#search-field', 'dach')
    await showing('Neues Dach')
    found = await results()
    assert.match(found[0], /^Neues DachBeitrag · 2025-03-04/)
    await page.fill('#search-field', 'grillen')
    await showing('Sommerfest')
    assert.match((await results())[0], /^SommerfestTermin/)
    // A word in the title ranks before a word in the text, and nothing found says so.
    await page.fill('#search-field', 'zzzzzz')
    await page.waitForFunction("document.querySelector('[data-status]').textContent.includes('Nichts gefunden')", undefined, { timeout: 5_000 })
    assert.equal((await results()).length, 0)
    // A result is a link to the page, and the header field submits to the search page.
    await page.fill('#search-field', 'werkstatt')
    await showing('Werkstatt')
    assert.equal(await page.getAttribute('[data-results] li a', 'href'), '/werkstatt/')
    await page.goto(`${PREVIEW_ORIGIN}/`)
    await page.fill('.site-search input', 'dach')
    await page.press('.site-search input', 'Enter')
    await page.waitForURL(`${PREVIEW_ORIGIN}/suche/?q=dach`)
    await settle()
    assert.match((await results())[0], /^Neues Dach/)
    // The English page searches the English index.
    await page.goto(`${PREVIEW_ORIGIN}/en/suche/?q=solder`)
    await settle()
    assert.match((await results())[0], /^WorkshopPage/)
    assert.equal(await page.textContent('[data-status]'), '1 result')
    await context.close()
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})
