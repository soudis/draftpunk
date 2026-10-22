import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { pruneHistory } from './history'

const big = 'x'.repeat(5000)

function turn(id: string, content: string): ModelMessage[] {
  return [
    { role: 'user', content: `Request ${id}` },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking '.repeat(100) },
        { type: 'tool-call', toolCallId: `r${id}`, toolName: 'read_design', input: { path: 'styles.css' } },
        { type: 'tool-call', toolCallId: `w${id}`, toolName: 'write_design', input: { path: 'styles.css', content } },
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: `r${id}`, toolName: 'read_design', output: { type: 'text', value: big } },
        { type: 'tool-result', toolCallId: `w${id}`, toolName: 'write_design', output: { type: 'text', value: 'Updated design/styles.css.' } },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: `Done ${id}` }] },
  ]
}

test('reads and written file contents from earlier turns shrink, and the current turn stays whole', () => {
  const messages = [...turn('1', big), ...turn('2', big)]
  const pruned = pruneHistory(messages)
  const first = JSON.stringify(pruned.slice(0, 4))
  const second = JSON.stringify(pruned.slice(4))
  assert.ok(first.length < 1500, `first turn is ${first.length} characters`)
  assert.match(first, /Earlier read_design result of \d+ characters dropped/)
  assert.match(first, /5000 characters were written/)
  assert.equal(first.includes('thinking'), false)
  assert.match(first, /Done 1/)
  assert.match(first, /Updated design\/styles\.css\./)
  assert.ok(second.includes(big))
})

test('an image result is dropped once a later step has run', () => {
  const image = { type: 'content' as const, value: [{ type: 'text' as const, text: 'screenshot' }, { type: 'media' as const, data: 'AAAA', mediaType: 'image/png' }] }
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Look at the page' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'preview_page', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'preview_page', output: image }] },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'b', toolName: 'preview_page', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'b', toolName: 'preview_page', output: image }] },
  ]
  const pruned = pruneHistory(messages)
  assert.equal(JSON.stringify(pruned[2]).includes('AAAA'), false)
  assert.equal(JSON.stringify(pruned[4]).includes('AAAA'), true)
})

test('when the history is still too long, the oldest turns keep only what was said', () => {
  const messages = [...turn('1', big), ...turn('2', big), ...turn('3', big)]
  const pruned = pruneHistory(messages, 1200)
  const current = pruned.map((message) => message.role === 'user' && message.content === 'Request 3').lastIndexOf(true)
  const older = pruned.slice(0, current)
  assert.equal(older.some((message) => message.role === 'tool'), false)
  assert.match(JSON.stringify(older), /Done 1/)
  assert.match(JSON.stringify(older), /Done 2/)
  assert.ok(JSON.stringify(pruned).includes(big))
})

test('a short result from an earlier turn is kept', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'One' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'list_pages', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'list_pages', output: { type: 'json', value: ['home — Start'] } }] },
    { role: 'user', content: 'Two' },
  ]
  assert.deepEqual(pruneHistory(messages), messages)
})
