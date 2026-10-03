import assert from 'node:assert/strict'
import test from 'node:test'
import { attachThoughtSignatures, tapThoughtSignatures } from './gemini'

test('a streamed tool call keeps its thought signature for the next step', async () => {
  const store = new Map<string, string>()
  const sse = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"extra_content":{"google":{"thought_signature":"sig-a"}},"function":{"name":"list_design","arguments":""}}]}}]}',
    '',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"arguments":"{}"}}]}}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  const response = tapThoughtSignatures(new Response(sse), store)
  assert.equal(await response.text(), sse)
  assert.equal(store.get('call-1'), 'sig-a')
  const next = attachThoughtSignatures(
    {
      messages: [
        {
          role: 'assistant',
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'list_design', arguments: '{}' } }],
        },
      ],
    },
    store,
  )
  const call = next.messages?.[0].tool_calls?.[0] as { extra_content?: { google?: { thought_signature?: string } } } | undefined
  assert.equal(call?.extra_content?.google?.thought_signature, 'sig-a')
})

test('a signature split across chunks is kept once the tool call id arrives', async () => {
  const store = new Map<string, string>()
  const encoder = new TextEncoder()
  const parts = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"extra_content":{"google":{"thought_sign',
    'ature":"sig-b"}},"function":{"name":"list_design","arguments":""}}]}}]}\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-2","function":{"arguments":"{}"}}]}}]}\n',
    'data: [DONE]\n',
  ]
  const body = new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
  const response = tapThoughtSignatures(new Response(body), store)
  await response.text()
  assert.equal(store.get('call-2'), 'sig-b')
})
