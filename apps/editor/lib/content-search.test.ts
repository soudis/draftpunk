import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, writePageFile, writeYaml } from '@schlor/generator'
import { searchContent } from './content-search'

test('search finds a phrase in a page and an event without returning other files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-search-'))
  initSite(root)
  writePageFile(path.join(root, 'content', 'pages', 'home', 'de.md'), {
    layout: 'home',
    title: 'Start',
    body: 'Willkommen im Hof.',
    data: {},
  })
  writeYaml(path.join(root, 'content', 'events', 'ping-pong-beisl.yml'), {
    slug: 'ping-pong-beisl',
    title: { de: 'Ping Pong Beisl' },
    body: { de: 'Herbsttermine im Hof' },
    place: 'rappachgasse',
    categories: [],
    dates: [],
  })
  fs.writeFileSync(path.join(root, 'design', 'brief.md'), 'Hof bleibt im Design.\n')
  const found = searchContent(root, 'hof')
  assert.match(found, /content\/pages\/home\/de\.md:\d+: Willkommen im Hof\./)
  assert.match(found, /content\/events\/ping-pong-beisl\.yml:\d+: de: Herbsttermine im Hof/)
  assert.doesNotMatch(found, /design\/brief\.md/)
  assert.equal(searchContent(root, 'a'), 'Pass a phrase of at least two characters to search pages, events, and places.')
  assert.equal(searchContent(root, 'kein-treffer'), 'No content matches kein-treffer.')
})
