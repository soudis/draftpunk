import assert from 'node:assert/strict'
import test from 'node:test'
import { streamText } from 'ai'
import { MockLanguageModelV2, simulateReadableStream } from 'ai/test'

// Undo finds a reply's commit by the id the server saw when the chat finished, so that id has to exist.
async function finishedIds(generateMessageId?: () => string): Promise<(string | undefined)[]> {
  const model = new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: 'ok' },
          { type: 'text-end', id: 't' },
          { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        ],
      }),
    }),
  })
  const result = streamText({ model, prompt: 'hi' })
  let ids: (string | undefined)[] = []
  const response = result.toUIMessageStreamResponse({
    originalMessages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    generateMessageId,
    onFinish: async ({ messages }) => {
      ids = messages.filter((message) => message.role === 'assistant').map((message) => message.id)
    },
  })
  await response.text()
  return ids
}

test('a reply has an id when the chat route asks for one', async () => {
  const [id] = await finishedIds(() => crypto.randomUUID())
  assert.ok(id && id.length > 10)
})

test('a reply has no id on the server without generateMessageId', async () => {
  const [id] = await finishedIds()
  assert.ok(!id)
})
