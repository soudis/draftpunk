import assert from 'node:assert/strict'
import test from 'node:test'
import { localHref, parseMenus, rewriteLinks, structureHtml } from './structure'

test('site links become paths on this site', () => {
  assert.equal(localHref('https://schlor.org/home/bauphasen'), '/bauphasen/')
  assert.equal(localHref('https://www.circus-trap.org/'), 'https://www.circus-trap.org/')
  assert.equal(localHref('https://schlor.org/crap'), '/crap/')
  assert.equal(rewriteLinks('unter www.schlor.org/crap.'), 'unter /crap/.')
})

test('the live menu keeps its children', () => {
  const html = `<div id="mainnav"><ul><li><a href="https://schlor.org/ueber-uns/">Über uns</a><ul><li><a href="https://schlor.org/ueber-uns/wer-wir-sind/">Wer wir sind</a></li></ul></li><li><a href="https://www.circus-trap.org/">TRAP</a></li></ul></div></nav><ul id="menu-website"><li><a href="https://schlor.org/impressum/">Impressum</a></li></ul>`
  const menus = parseMenus(html)
  assert.equal(menus.menu[0].label.de, 'Über uns')
  assert.equal(menus.menu[0].children?.[0].href, '/ueber-uns/wer-wir-sind/')
  assert.equal(menus.menu[1].href, 'https://www.circus-trap.org/')
  assert.equal(menus.footer[0].href, '/impressum/')
})

test('a room keeps photos and the email outside the prose', () => {
  const html = `<p>Die Werkstatt.</p><img src="https://schlor.org/wp-content/uploads/a.jpg" alt="Hof"><img src="https://schlor.org/wp-content/uploads/a-1600x900.jpg" alt="Hof"><a href="mailto:raum@schlor.org">raum@schlor.org</a>`
  const page = structureHtml('room', html, (value) => value.replace(/<[^>]+>/g, ' ').trim())
  assert.equal((page.data.images as { src: string }[]).length, 1)
  assert.equal(page.data.email, 'raum@schlor.org')
  assert.equal(String(page.body).includes('<img'), false)
})

test('a gallery uses the linked photo and an ally keeps its mark', () => {
  const gallery = structureHtml('gallery', `<h2>September 2024</h2><figure><a href="https://schlor.org/wp-content/uploads/crap.jpg"><img src="https://schlor.org/wp-content/uploads/crap-150x150.jpg" alt=""></a><figcaption>Crap Bau</figcaption></figure>`, (value) => value)
  const items = (gallery.data.groups as { items: { src: string; label?: string }[] }[])[0].items
  assert.equal(items[0].src, 'https://schlor.org/wp-content/uploads/crap.jpg')
  assert.equal(items[0].label, 'Crap Bau')
  const allies = structureHtml('allies', `<h2>Syndikate</h2><a href="https://habitat.servus.at/"><img src="https://schlor.org/mark.jpg" alt=""></a>`, (value) => value)
  const links = (allies.data.groups as { links: { href: string; image?: string; label: string }[] }[])[0].links
  assert.equal(links[0].href, 'https://habitat.servus.at/')
  assert.equal(links[0].image, 'https://schlor.org/mark.jpg')
  assert.equal(links[0].label, 'habitat.servus.at')
})

test('the homepage keeps the three projects and drops the news list', () => {
  const html = `<h1>SchloR</h1><h4>Ein Ort</h4><p>Wir sind ein selbstverwaltetes Projekt mit genug Text für den Absatz über Wohnen und Arbeiten.</p><h1>Termine, Termine, Termine</h1><p>Kalender</p><h1>Danke für 1.000 Freund*innen im Rücken!</h1><h4>Unsere Direktkreditkampagne ist mal vorbei – und war ein voller Erfolg!</h4><p>Ein privater Kredit an das Projekt, kündbar, mit Rückzahlung innerhalb von sechs Monaten.</p><h1>Unsere Betriebe</h1><h2><a href="/crap">CRAP</a></h2><img src="https://schlor.org/a.jpg"><h2><a href="https://www.circus-trap.org/">TRAP</a></h2><h1>Aktuelles</h1><p>Tichu</p>`
  const page = structureHtml('home', html, (value) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  const cards = page.data.cards as { title: string; href: string }[]
  assert.deepEqual(cards.map((card) => card.title), ['CRAP', 'Wohnen', 'TRAP'])
  assert.equal(cards[2].href, 'https://www.circus-trap.org/')
  assert.equal(String(page.body).includes('Tichu'), false)
  assert.equal(String(page.body).includes('Termine'), false)
})
