import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanChatName, fallbackChatName } from './chat-name'

test('a chat name is a short line from the first input', () => {
  assert.equal(cleanChatName('  "Homepage hero"\nmore'), 'Homepage hero')
  assert.equal(
    fallbackChatName('Please rewrite the homepage hero so it mentions the courtyard. Then change the contact page.'),
    'Please rewrite the homepage hero so it mentions',
  )
})
