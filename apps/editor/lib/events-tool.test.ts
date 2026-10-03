import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, writeYaml } from '@schlor/generator'
import { contentTools } from './tools'

test('read_event returns the event that write_event would change', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-event-'))
  initSite(root)
  writeYaml(path.join(root, 'content', 'events', 'ping-pong-beisl.yml'), {
    slug: 'ping-pong-beisl',
    title: { de: 'Ping Pong Beisl', en: 'Ping Pong Beisl' },
    body: { de: 'Herbsttermine', en: 'Autumn dates' },
    place: 'rappachgasse',
    categories: ['cafe-beisl'],
    dates: [{ start: '2026-10-22T17:00:00.000Z', end: '2026-10-22T20:00:00.000Z' }],
  })
  const tools = contentTools(root)
  const listed = await tools.list_events.execute!({}, { toolCallId: 'list', messages: [] })
  assert.ok(Array.isArray(listed))
  assert.match(listed.join('\n'), /ping-pong-beisl — Ping Pong Beisl — 2026-10-22T17:00:00.000Z–2026-10-22T20:00:00.000Z/)
  const read = await tools.read_event.execute!({ slug: 'ping-pong-beisl' }, { toolCallId: 'read', messages: [] })
  assert.match(String(read), /Herbsttermine/)
  assert.equal(await tools.read_event.execute!({ slug: 'missing-event' }, { toolCallId: 'miss', messages: [] }), 'Missing event missing-event')
})
