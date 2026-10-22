import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { pruneHistory, repairHistory, withoutEmptyReplies } from './history'

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

type Loose = { role: string; content: unknown }

// What a provider checks: a tool result follows the assistant message that called it, every call has its result.
function problems(messages: ModelMessage[]): string[] {
  const found: string[] = []
  messages.forEach((message, index) => {
    const content = (Array.isArray(message.content) ? message.content : []) as { type: string; toolCallId?: string }[]
    if (message.role === 'assistant') {
      const calls = content.filter((part) => part.type === 'tool-call').map((part) => part.toolCallId)
      const next = messages[index + 1] as Loose | undefined
      const results = next?.role === 'tool' ? (next.content as { toolCallId?: string }[]).map((part) => part.toolCallId) : []
      for (const id of calls) if (!results.includes(id)) found.push(`call ${id} at ${index} has no result`)
      if (typeof message.content === 'string' ? message.content === '' : content.length === 0) found.push(`empty assistant at ${index}`)
    }
    if (message.role === 'tool') {
      const before = messages[index - 1] as Loose | undefined
      const calls = before?.role === 'assistant' && Array.isArray(before.content) ? (before.content as { type: string; toolCallId?: string }[]).filter((part) => part.type === 'tool-call').map((part) => part.toolCallId) : []
      for (const part of content) if (!calls.includes(part.toolCallId)) found.push(`result ${part.toolCallId} at ${index} has no call`)
    }
  })
  return found
}

function steps(id: string, count: number): ModelMessage[] {
  const out: ModelMessage[] = [{ role: 'user', content: `Request ${id}` }]
  for (let step = 0; step < count; step += 1) {
    const call = `${id}-${step}`
    out.push({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking '.repeat(200) },
        { type: 'tool-call', toolCallId: `${call}a`, toolName: 'read_page', input: { slug: 'home' } },
        { type: 'tool-call', toolCallId: `${call}b`, toolName: 'read_page', input: { slug: 'kontakt' } },
      ],
    })
    out.push({
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: `${call}a`, toolName: 'read_page', output: { type: 'text', value: 'a'.repeat(300) } },
        { type: 'tool-result', toolCallId: `${call}b`, toolName: 'read_page', output: { type: 'text', value: 'b'.repeat(300) } },
      ],
    })
  }
  out.push({ role: 'assistant', content: [{ type: 'reasoning', text: 'done' }, { type: 'text', text: `Done ${id}` }] })
  return out
}

test('fitting the budget never leaves a tool result without its call, whatever the budget and the reasoning', () => {
  const history = [...steps('1', 5), ...steps('2', 4), ...steps('3', 6), ...steps('4', 3)]
  for (const keepReasoning of [false, true]) {
    for (let budget = 0; budget <= 60_000; budget += 700) {
      const pruned = pruneHistory(history, budget, { keepReasoning })
      assert.deepEqual(problems(pruned), [], `budget ${budget}, keepReasoning ${keepReasoning}`)
      assert.equal((pruned[pruned.length - 1].content as { type: string; text?: string }[]).find((part) => part.type === 'text')?.text, 'Done 4')
    }
  }
})

test('repair removes a result without its call, a call without its result, and an empty reply', () => {
  const messages: ModelMessage[] = [
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'lost', toolName: 'read_page', output: { type: 'text', value: 'x' } }] },
    { role: 'user', content: 'Go on' },
    { role: 'assistant', content: [] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Reading' },
        { type: 'tool-call', toolCallId: 'a', toolName: 'read_page', input: {} },
        { type: 'tool-call', toolCallId: 'b', toolName: 'read_page', input: {} },
      ],
    },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'read_page', output: { type: 'text', value: 'ok' } }] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'only thoughts' }] },
  ]
  const repaired = repairHistory(messages)
  assert.deepEqual(problems(repaired), [])
  assert.equal(repaired.length, 3)
  assert.equal(JSON.stringify(repaired).includes('"b"'), false)
})

test('a failed request leaves no empty reply behind', () => {
  const kept = withoutEmptyReplies([
    { role: 'user', parts: [{ type: 'text', text: 'weiter' }] },
    { role: 'assistant', parts: [] },
    { role: 'assistant', parts: [{ type: 'step-start' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'Hallo' }] },
    { role: 'assistant', parts: [{ type: 'tool-read_page' }] },
  ])
  assert.deepEqual(kept.map((message) => message.parts[0]?.type), ['text', 'text', 'tool-read_page'])
})
