import assert from 'node:assert/strict'
import test from 'node:test'
import { streamText, wrapLanguageModel } from 'ai'
import { MockLanguageModelV2, simulateReadableStream } from 'ai/test'
import { leakedCallMiddleware, NUDGE, stripLeakedCalls } from './leaked-calls'

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }

function reply(parts: object[]) {
  return { stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...parts] as never[] }) }
}
const text = (id: string, deltas: string[]) => [{ type: 'text-start', id }, ...deltas.map((delta) => ({ type: 'text-delta', id, delta })), { type: 'text-end', id }]

test('text without markup is cut at the markup and nothing else is touched', () => {
  assert.equal(stripLeakedCalls('Fertig.'), 'Fertig.')
  assert.equal(stripLeakedCalls('Ich prüfe. <｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="x">'), 'Ich prüfe.')
  assert.equal(stripLeakedCalls('1 < 2 and a | b'), '1 < 2 and a | b')
})

test('a tool call written as text is hidden, and the model is asked once more', async () => {
  const calls: unknown[] = []
  const model = new MockLanguageModelV2({
    doStream: async (options) => {
      calls.push(options.prompt)
      if (calls.length === 1) {
        return reply([
          ...text('t', ['Ich prüfe die Seite. <', '｜｜DSML｜｜ calls>', '\n<｜｜DSML｜｜ invoke name="preview_page">']),
          { type: 'finish', finishReason: 'stop', usage },
        ]) as never
      }
      return reply([...text('u', ['Alles gut.']), { type: 'finish', finishReason: 'stop', usage }]) as never
    },
  })
  const result = streamText({ model: wrapLanguageModel({ model, middleware: leakedCallMiddleware() }), prompt: 'Prüfe die Seite' })
  const answer = await result.text
  assert.equal(answer, 'Ich prüfe die Seite. Alles gut.')
  assert.equal(calls.length, 2)
  const last = (calls[1] as { role: string; content: { text?: string }[] }[]).at(-1)
  assert.equal(last?.role, 'user')
  assert.equal(last?.content[0].text, NUDGE)
  assert.equal((await result.usage).totalTokens, 30)
})

test('ordinary text passes through whole, and a real tool call is never asked again', async () => {
  let count = 0
  const model = new MockLanguageModelV2({
    doStream: async () => {
      count += 1
      return reply([...text('t', ['Eine ', 'Zahl < 5 und <', ' mehr']), { type: 'finish', finishReason: 'stop', usage }]) as never
    },
  })
  const result = streamText({ model: wrapLanguageModel({ model, middleware: leakedCallMiddleware() }), prompt: 'Hallo' })
  assert.equal(await result.text, 'Eine Zahl < 5 und < mehr')
  assert.equal(count, 1)
})

test('a second leak is hidden too, and the model is not asked a third time', async () => {
  let count = 0
  const model = new MockLanguageModelV2({
    doStream: async () => {
      count += 1
      return reply([...text('t', ['Nochmal <｜｜DSML｜｜ calls>']), { type: 'finish', finishReason: 'stop', usage }]) as never
    },
  })
  const result = streamText({ model: wrapLanguageModel({ model, middleware: leakedCallMiddleware() }), prompt: 'Hallo' })
  assert.equal((await result.text).trim(), 'Nochmal Nochmal')
  assert.equal(count, 2)
})
