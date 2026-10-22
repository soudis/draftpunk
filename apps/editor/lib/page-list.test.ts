import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ensureGit } from './git'
import { pageEntries } from './page-list'
import { pageForPath, previewAddress, type PageEntry } from './page-match'

const entries: PageEntry[] = [
  { slug: 'home', title: 'Start', urls: { de: '/', en: '/en/' } },
  { slug: 'kontakt', title: 'Kontakt', urls: { de: '/kontakt/', en: '/en/kontakt/' } },
]

test('a preview address belongs to a page and a language', () => {
  assert.deepEqual(pageForPath(entries, '/preview/')?.entry.slug, 'home')
  assert.deepEqual(pageForPath(entries, '/preview'), pageForPath(entries, '/preview/'))
  assert.equal(pageForPath(entries, '/preview/en/')?.lang, 'en')
  assert.equal(pageForPath(entries, '/preview/kontakt')?.entry.slug, 'kontakt')
  assert.equal(pageForPath(entries, '/preview/en/kontakt/index.html?v=3')?.lang, 'en')
  assert.equal(pageForPath(entries, '/preview/calendar/'), null)
})

test('a page opens in the language that is shown', () => {
  assert.equal(previewAddress(entries[1], 'en'), '/preview/en/kontakt/')
  assert.equal(previewAddress(entries[1], null), '/preview/kontakt/')
  assert.equal(previewAddress(entries[0], 'de'), '/preview/')
})

test('the pages of the starter site are listed with the home page first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-pages-'))
  ensureGit(root)
  const list = pageEntries(root)
  assert.equal(list[0].slug, 'home')
  assert.ok(list.length > 1)
  assert.ok(Object.keys(list[0].urls).length >= 1)
  assert.ok(list.every((entry) => entry.title.length > 0))
})
