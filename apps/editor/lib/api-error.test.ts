import assert from 'node:assert/strict'
import test from 'node:test'
import { chatErrorText, presentChatError } from './api-error'

const geminiBody = JSON.stringify([
  {
    error: {
      code: 400,
      message:
        'Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly.',
      status: 'INVALID_ARGUMENT',
    },
  },
])

test('a Gemini API failure keeps the error type and the first sentence', () => {
  const text = chatErrorText({
    name: 'AI_APICallError',
    message: 'Bad Request',
    statusCode: 400,
    responseBody: geminiBody,
  })
  const presented = presentChatError(text)
  assert.equal(presented.type, 'AI_APICallError · INVALID_ARGUMENT')
  assert.equal(
    presented.description,
    'Function call is missing a thought_signature in functionCall parts.',
  )
  assert.equal(text.includes('requestBodyValues'), false)
})

test('a dumped API error still shows a type and a short description', () => {
  const dumped = `Error [AI_APICallError]: Bad Request
    at <unknown> (.next/server/chunks/chat.js:1:1)
  responseBody: '[{\\n  "error": {\\n    "message": "Function call is missing a thought_signature in functionCall parts.",\\n    "status": "INVALID_ARGUMENT"\\n  }\\n}]'`
  const presented = presentChatError(dumped)
  assert.equal(presented.type, 'AI_APICallError · INVALID_ARGUMENT')
  assert.equal(presented.description, 'Function call is missing a thought_signature in functionCall parts.')
})

test('a browser stream failure says the reply was cut off', () => {
  assert.deepEqual(presentChatError('Error in input stream'), {
    type: 'Connection closed',
    description: 'The reply stopped before it finished. Send it again.',
  })
})

test('a plain failure stays a single short line', () => {
  assert.deepEqual(presentChatError('LLM_API_KEY is not set'), {
    type: 'API error',
    description: 'LLM_API_KEY is not set',
  })
})
