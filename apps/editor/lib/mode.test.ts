import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeThread } from './thread'
import { initialMode, modeFromMessages, unavailableToolMessage } from './mode'

test('a thread that already read the design stays in design mode', () => {
  const messages = [
    { parts: [{ type: 'tool-read_page' }] },
    { parts: [{ type: 'tool-read_design' }, { type: 'tool-list_design' }] },
  ]
  assert.equal(modeFromMessages(messages), 'design')
  const stored = decodeThread(JSON.stringify(messages))
  assert.equal(stored.mode, 'design')
  assert.equal(stored.messages.length, 2)
})

test('an explicit mode is kept when the thread is saved', () => {
  const stored = decodeThread(JSON.stringify({ messages: [{ parts: [{ type: 'tool-read_design' }] }], mode: 'content' }))
  assert.equal(stored.mode, 'content')
})

test('page reads after a design tool keep design mode until a page is written', () => {
  assert.equal(
    modeFromMessages([
      { parts: [{ type: 'tool-read_design' }] },
      { parts: [{ type: 'tool-read_page' }, { type: 'tool-list_pages' }] },
    ]),
    'design',
  )
  assert.equal(
    modeFromMessages([{ parts: [{ type: 'tool-read_design' }] }, { parts: [{ type: 'tool-write_page' }] }]),
    'content',
  )
})

test('reading an event stays in content mode', () => {
  assert.equal(modeFromMessages([{ parts: [{ type: 'tool-read_event' }] }]), 'content')
  assert.equal(modeFromMessages([{ parts: [{ type: 'tool-search_content' }] }]), 'content')
  assert.equal(modeFromMessages([{ parts: [{ type: 'tool-delete_page' }] }]), 'content')
  assert.equal(modeFromMessages([{ parts: [{ type: 'tool-read_design' }] }, { parts: [{ type: 'tool-discard_picture' }] }]), 'content')
})

test('a setup tool names setup mode', () => {
  assert.equal(modeFromMessages([{ parts: [{ type: 'tool-read_site' }] }]), 'setup')
  assert.equal(
    unavailableToolMessage('content', 'accept_setup'),
    'accept_setup is only available in Setup mode. Switch to Setup and send the request again.',
  )
  assert.equal(initialMode('setup', 'content'), 'setup')
})

test('a chosen mode wins over the saved thread, and a design tool names its mode', () => {
  assert.equal(initialMode('design', 'content'), 'design')
  assert.equal(initialMode(null, 'design'), 'design')
  assert.equal(
    unavailableToolMessage('content', 'accept_setup'),
    'accept_setup is only available in Setup mode. Switch to Setup and send the request again.',
  )
})
