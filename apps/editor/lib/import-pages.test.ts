import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { listPageSlugs, readPage, readYaml } from '@schlor/generator'
import { ensureGit } from './git'
import {
  firstParagraph,
  importPages,
  originalPicture,
  matchRule,
  normalPath,
  recordPath,
  rewriteLinks,
  slugFor,
  splitLanguage,
  splitTitle,
  tidyMarkdown,
  type ImportDeps,
  type PageRead,
} from './import-pages'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function site() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-import-'))
  ensureGit(root)
  return root
}

const pages: Record<string, PageRead> = {
  '/ueber-uns': {
    title: 'Über uns – Haus Muster',
    markdown: '# Über uns\n\n![Der Hof](https://old.example/img/hof.png)\n\nWir sind ein **Haus** in Wien.\n\nMehr im [Kalender](https://old.example/news/a) und bei [uns](https://old.example/nirgends).',
    date: '',
  },
  '/en/ueber-uns': { title: 'About – House', markdown: '# About us\n\nWe are a house in Vienna.', date: '' },
  '/news/a': { title: 'Sommerfest | Haus Muster', markdown: '# Sommerfest\n\nAm 5. Juli im Hof.', date: '2025-07-05' },
  '/news/b': { title: 'Neues Dach', markdown: 'Das Dach ist fertig. Mehr [über uns](https://old.example/ueber-uns).', date: '' },
}

function deps(overrides: Partial<ImportDeps> = {}): ImportDeps & { reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    listPaths: async () => ({
      origin: 'https://old.example',
      sitemap: true,
      paths: ['/', '/ueber-uns', '/en/ueber-uns', '/en/only-english', '/news/a', '/news/b', '/wp-admin/x', '/kontakt', '/tag/foo', '/misc'],
    }),
    readPage: async (url) => {
      reads.push(url)
      const page = pages[new URL(url).pathname]
      if (!page) throw new Error(`Could not read ${url}.`)
      return page
    },
    fetchPicture: async (url) => ({ url, body: PNG }),
    ...overrides,
  }
}

const rules = [
  { match: '/news/', layout: 'article', dated: true },
  { match: '/ueber-uns', layout: 'article' },
  { match: '/kontakt', layout: 'article' },
]

test('addresses become languages, rules and page names', () => {
  assert.equal(normalPath('/a/b/?x=1#y'), '/a/b')
  assert.deepEqual(splitLanguage('/en/ueber-uns/', ['de', 'en']), { lang: 'en', rest: '/ueber-uns' })
  assert.deepEqual(splitLanguage('/ueber-uns', ['de', 'en']), { lang: 'de', rest: '/ueber-uns' })
  assert.deepEqual(splitLanguage('/fr/a', ['de', 'en']), { lang: 'de', rest: '/fr/a' })
  const list = [{ match: '/news/', layout: 'a' }, { match: '/about', layout: 'b' }, { match: '*', layout: 'c' }]
  assert.equal(matchRule(list, '/news/x')?.layout, 'a')
  assert.equal(matchRule(list, '/news')?.layout, 'a')
  assert.equal(matchRule(list, '/about')?.layout, 'b')
  assert.equal(matchRule(list, '/about/team')?.layout, 'c')
  assert.equal(matchRule([{ match: '/about', layout: 'b' }], '/other'), null)
  assert.equal(slugFor('/Über-uns/Straße'), 'uber-uns-strasse')
  assert.equal(slugFor('/news/2025/sommer fest'), 'news-2025-sommer-fest')
  assert.equal(slugFor('/1-habitat-hausprojekt-in-salzburg-steht-kurz-vor-der-realisierung'), '1-habitat-hausprojekt-in-salzburg-steht-kurz-vor-der')
  assert.equal(originalPicture('https://x.org/a/Foto-150x150.jpg'), 'https://x.org/a/Foto.jpg')
  assert.equal(originalPicture('https://x.org/a/Foto-1536x866.jpeg?v=2'), 'https://x.org/a/Foto.jpeg?v=2')
  assert.equal(originalPicture('https://x.org/a/foto.jpg'), null)
})

test('the first heading is the title, the rest keeps no top heading, and a summary is plain text', () => {
  assert.deepEqual(splitTitle({ title: 'x', markdown: '# Hallo\n\nText', date: '' }), { title: 'Hallo', markdown: '\nText' })
  assert.equal(splitTitle({ title: 'Kontakt – Haus Muster', markdown: 'Text', date: '' }).title, 'Kontakt')
  assert.equal(splitTitle({ title: 'Aktuelles • SchloR', markdown: 'Text', date: '' }).title, 'Aktuelles')
  assert.equal(tidyMarkdown('Text\n\n### Schreibe einen Kommentar\n\nName'), 'Text')
  assert.equal(tidyMarkdown('# Eins\n\n\n\n## Zwei'), '## Eins\n\n## Zwei')
  assert.equal(firstParagraph('# T\n\n![a](x.png)\n\nEin **guter** [Satz](https://x.org).\n\nZwei'), 'Ein guter Satz.')
})

test('links to pages that exist here point at them', () => {
  const known = new Map([['/news/a', '/news-a/']])
  assert.equal(rewriteLinks('Siehe [a](https://www.old.example/news/a/#x) und [b](https://old.example/b) und [c](https://other.org/news/a).', 'https://old.example', known),
    'Siehe [a](/news-a/#x) und [b](https://old.example/b) und [c](https://other.org/news/a).')
})

test('a rule that does not fit the layout is refused before anything is read', async () => {
  const root = site()
  const fake = deps()
  await assert.rejects(importPages(root, { source: 'https://old.example', rules: [{ match: '*', layout: 'nope' }] }, fake), /does not exist/)
  await assert.rejects(importPages(root, { source: 'https://old.example', rules: [{ match: '*', layout: 'article', body: 'missing' }] }, fake), /no slot missing/)
  await assert.rejects(importPages(root, { source: 'https://old.example', rules: [{ match: '*', layout: 'article', lead: 'body' }] }, fake), /needs image/)
  assert.deepEqual(fake.reads, [])
})

test('pages are imported by rule, with pictures, languages, links and a record', async () => {
  const root = site()
  const fake = deps()
  const result = await importPages(root, { source: 'https://old.example', rules, skip: ['/kontakt'] }, fake)
  assert.match(result, /Imported 3 pages and 1 picture from https:\/\/old\.example/)
  assert.match(result, /\/ueber-uns → ueber-uns \(de, en\)/)
  assert.match(result, /Every page that matches your rules is imported/)
  assert.match(result, /1 pages were left out because the first pass already has them/)
  assert.match(result, /1 pages match no rule, for example \/misc/)
  assert.match(result, /1 pages exist only in another language/)

  const about = readPage(root, 'ueber-uns')!
  assert.deepEqual(about.title, { de: 'Über uns', en: 'About us' })
  const body = about.slots.body as Record<string, string>
  assert.match(body.de, /!\[Der Hof\]\(\/media\/hof\.png\)/)
  assert.doesNotMatch(body.de, /old\.example\/img/)
  assert.match(body.de, /\[Kalender\]\(\/news-a\/\)/)
  assert.match(body.de, /\[uns\]\(https:\/\/old\.example\/nirgends\)/)
  assert.equal(body.en, 'We are a house in Vienna.')
  assert.ok(fs.existsSync(path.join(root, 'media', 'hof.png')))

  const news = readPage(root, 'news-a')!
  assert.equal(news.date, '2025-07-05')
  assert.deepEqual(news.title, { de: 'Sommerfest' })
  assert.equal(readPage(root, 'news-b')!.title.de, 'Neues Dach')
  assert.equal(readPage(root, 'misc'), null)
  assert.equal(readPage(root, 'tag-foo'), null)

  const record = readYaml<{ source: string; pages: Record<string, string>; pictures: Record<string, string> }>(recordPath(root), {} as never)
  assert.equal(record.source, 'https://old.example')
  assert.equal(record.pages['/ueber-uns'], 'ueber-uns')
  assert.equal(record.pages['/en/ueber-uns'], 'ueber-uns')
  assert.equal(record.pictures['https://old.example/img/hof.png'], '/media/hof.png')
})

test('a second call leaves imported pages alone, and refresh reads them again', async () => {
  const root = site()
  await importPages(root, { source: 'https://old.example', rules, skip: ['/kontakt'] }, deps())
  const edited = readPage(root, 'news-b')!
  edited.title.de = 'Von Hand geändert'
  fs.writeFileSync(path.join(root, 'content', 'pages', 'news-b.yml'), fs.readFileSync(path.join(root, 'content', 'pages', 'news-b.yml'), 'utf8').replace('Neues Dach', 'Von Hand geändert'))
  const fake = deps()
  const again = await importPages(root, { source: 'https://old.example', rules, skip: ['/kontakt'] }, fake)
  assert.match(again, /No page was imported in this call/)
  assert.match(again, /3 pages were imported before/)
  assert.deepEqual(fake.reads, [])
  assert.equal(readPage(root, 'news-b')!.title.de, 'Von Hand geändert')
  const refreshed = await importPages(root, { source: 'https://old.example', rules, skip: ['/kontakt'], refresh: true }, deps())
  assert.match(refreshed, /Imported 3 pages and 0 pictures/)
  assert.equal(readPage(root, 'news-b')!.title.de, 'Neues Dach')
})

test('a long list goes in calls of the limit, and the next call continues', async () => {
  const root = site()
  const first = await importPages(root, { source: 'https://old.example', rules, skip: ['/kontakt'], limit: 2 }, deps())
  assert.match(first, /Imported 2 pages/)
  assert.match(first, /1 more pages match your rules\. Call import_pages again/)
  const second = await importPages(root, { source: 'https://old.example', rules, skip: ['/kontakt'], limit: 2 }, deps())
  assert.match(second, /Imported 1 page and/)
  assert.match(second, /Every page that matches your rules is imported/)
  assert.match(second, /1 earlier pages now link to the new pages/)
  assert.match((readPage(root, 'news-b')!.slots.body as Record<string, string>).de, /\[über uns\]\(\/ueber-uns\/\)/)
})

test('a page that cannot be read, a name that is taken and a picture that fails are reported', async () => {
  const root = site()
  const fake = deps({
    readPage: async (url) => {
      if (new URL(url).pathname === '/news/b') throw new Error('Could not read it: it did not answer in time.')
      return pages[new URL(url).pathname] ?? { title: 'x', markdown: 'Text', date: '' }
    },
    fetchPicture: async () => {
      throw new Error('too large')
    },
  })
  const result = await importPages(root, { source: 'https://old.example', rules }, fake)
  assert.match(result, /\/news\/b: .*did not answer in time/)
  assert.match(result, /\/kontakt: a page named kontakt exists already/)
  assert.match(result, /1 pictures could not be saved/)
  const body = (readPage(root, 'ueber-uns')!.slots.body as Record<string, string>).de
  assert.doesNotMatch(body, /!\[/)
})

test('a site without a sitemap says that its list may be incomplete', async () => {
  const root = site()
  const result = await importPages(root, { source: 'https://old.example', rules: [{ match: '/news/', layout: 'article' }] }, deps({ listPaths: async () => ({ origin: 'https://old.example', sitemap: false, paths: ['/news/a'] }) }))
  assert.match(result, /no sitemap/)
})

test('a lead picture and a summary are taken out of the page', async () => {
  const root = site()
  const layouts = path.join(root, 'design', 'layouts', 'story')
  fs.mkdirSync(layouts, { recursive: true })
  fs.writeFileSync(path.join(layouts, 'layout.yml'), 'purpose: "A story with a lead picture and a summary."\nslots:\n  body:\n    type: markdown\n    required: true\n  intro: text\n  hero: image\n')
  fs.writeFileSync(path.join(layouts, 'template.njk'), '<main><h1>{{ title }}</h1><img src="{{ slots.hero }}" alt="">{{ slots.intro }}{{ slots.body | safe }}</main>\n')
  fs.writeFileSync(path.join(layouts, 'style.css'), '')
  await importPages(root, { source: 'https://old.example', rules: [{ match: '/ueber-uns', layout: 'story', summary: 'intro', lead: 'hero' }], limit: 5 }, deps())
  const story = readPage(root, 'ueber-uns')!
  assert.equal(story.slots.hero, '/media/hof.png')
  assert.equal((story.slots.intro as Record<string, string>).de, 'Wir sind ein Haus in Wien.')
  assert.doesNotMatch((story.slots.body as Record<string, string>).de, /hof\.png/)
})

test('a small picture is replaced by its larger original when that can be read, and a picture is saved once', async () => {
  const root = site()
  const asked: string[] = []
  const fake = deps({
    listPaths: async () => ({ origin: 'https://old.example', sitemap: true, paths: ['/galerie'] }),
    readPage: async () => ({ title: 'Galerie', markdown: '![a](https://old.example/up/Hof-150x150.png)\n\n![b](https://old.example/up/Hof-300x200.png)\n\n![c](https://old.example/up/Dach-150x150.png)', date: '' }),
    fetchPicture: async (url) => {
      asked.push(url)
      if (url.endsWith('/Dach.png')) throw new Error('not there')
      return { url, body: PNG }
    },
  })
  await importPages(root, { source: 'https://old.example', rules: [{ match: '*', layout: 'article' }] }, fake)
  assert.deepEqual(asked, ['https://old.example/up/Hof.png', 'https://old.example/up/Dach.png', 'https://old.example/up/Dach-150x150.png'])
  const body = (readPage(root, 'galerie')!.slots.body as Record<string, string>).de
  assert.equal(body.match(/\/media\/hof\.png/g)?.length, 2)
  assert.match(body, /\/media\/dach-150x150\.png/)
})

test('a picture name written with percent codes is read as the word it spells', async () => {
  const root = site()
  await importPages(root, { source: 'https://old.example', rules: [{ match: '*', layout: 'article' }] }, deps({
    listPaths: async () => ({ origin: 'https://old.example', sitemap: true, paths: ['/essen'] }),
    readPage: async () => ({ title: 'Essen', markdown: '![x](https://old.example/up/Ern%C3%A4hrung.png)', date: '' }),
  }))
  assert.ok(fs.existsSync(path.join(root, 'media', 'ernahrung.png')))
})

test('a call stops starting page reads when its time is used up, and the next call continues without doubling anything', async () => {
  const root = site()
  const paths = Array.from({ length: 30 }, (_value, index) => `/seite-${String(index).padStart(2, '0')}`)
  let running = 0
  let most = 0
  const reads: string[] = []
  const slow = {
    ...deps(),
    listPaths: async () => ({ origin: 'https://old.example', paths, sitemap: true }),
    readPage: async (url: string) => {
      running += 1
      most = Math.max(most, running)
      reads.push(url)
      await new Promise((resolve) => setTimeout(resolve, 30))
      running -= 1
      return { title: `Titel ${url}`, markdown: `Text von ${url}`, date: '' }
    },
    budgetMs: 100,
  }
  const rules = [{ match: '*', layout: 'article' }]
  const first = await importPages(root, { source: 'https://old.example', rules }, slow)
  assert.match(first, /Imported \d+ pages?/)
  const firstDone = reads.length
  assert.ok(firstDone > 0 && firstDone < 30, `read ${firstDone}`)
  assert.ok(most > 1 && most <= 5, `at most ${most} at once`)
  assert.match(first, /\d+ more pages match your rules\. Call import_pages again/)
  let calls = 1
  let text = first
  while (/more pages match/.test(text) && calls < 10) {
    text = await importPages(root, { source: 'https://old.example', rules }, slow)
    calls += 1
  }
  assert.match(text, /Every page that matches your rules is imported/)
  assert.equal(new Set(reads).size, 30)
  assert.equal(reads.length, 30)
  assert.equal(listPageSlugs(root).filter((slug) => slug.startsWith('seite-')).length, 30)
})

test('pictures are saved a few at a time, and each one once', async () => {
  const root = site()
  const base = deps()
  let running = 0
  let most = 0
  const fetched: string[] = []
  const pictures = {
    ...base,
    listPaths: async () => ({ origin: 'https://old.example', paths: ['/galerie'], sitemap: true }),
    readPage: async () => ({ title: 'Galerie', markdown: Array.from({ length: 10 }, (_value, index) => `![Bild ${index}](https://old.example/up/bild-${index}.png)`).join('\n\n'), date: '' }),
    fetchPicture: async (url: string) => {
      running += 1
      most = Math.max(most, running)
      fetched.push(url)
      await new Promise((resolve) => setTimeout(resolve, 20))
      running -= 1
      return { url, body: PNG }
    },
  }
  await importPages(root, { source: 'https://old.example', rules: [{ match: '*', layout: 'article' }] }, pictures)
  assert.equal(fetched.length, 10)
  assert.equal(new Set(fetched).size, 10)
  assert.ok(most > 1 && most <= 4, `at most ${most} at once`)
})
