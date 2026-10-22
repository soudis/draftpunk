import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import test from 'node:test'
import { createChat, deleteChat, listChats, migrate, openChat, saveChat } from './sessions'

function database() {
  const opened = new Database(':memory:')
  migrate(opened)
  return opened
}

test('each person only sees their own chats', () => {
  const opened = database()
  const ada = createChat(opened, 'ada', 'edit')
  saveChat(opened, 'ada', ada.id, [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Rewrite the homepage hero' }] }], 'setup')
  const listed = listChats(opened, 'ada')
  assert.equal(listed.sessions[0].title, 'Rewrite the homepage hero')
  assert.equal(listed.current.mode, 'setup')
  assert.equal(openChat(opened, 'bao', ada.id), null)
  const bao = listChats(opened, 'bao')
  assert.equal(bao.sessions.length, 1)
  assert.notEqual(bao.current.id, ada.id)
  assert.equal(bao.current.messages.length, 0)
})

test('the name from the first input stays when a later message is saved', () => {
  const opened = database()
  const ada = createChat(opened, 'ada', 'edit')
  const first = [{ id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Rewrite the homepage hero' }] }]
  saveChat(opened, 'ada', ada.id, first, 'edit', 'Homepage hero')
  saveChat(opened, 'ada', ada.id, [...first, { id: 'm2', role: 'user', parts: [{ type: 'text', text: 'Now change the contact page' }] }], 'edit')
  assert.equal(openChat(opened, 'ada', ada.id)?.title, 'Homepage hero')
})

test('deleting a chat leaves the other person untouched and opens another chat', () => {
  const opened = database()
  const ada = createChat(opened, 'ada', 'edit')
  const bao = createChat(opened, 'bao', 'edit')
  const removed = deleteChat(opened, 'ada', ada.id)
  assert.ok(removed)
  assert.equal(removed.sessions.some((session) => session.id === ada.id), false)
  assert.equal(openChat(opened, 'bao', bao.id)?.id, bao.id)
  assert.equal(deleteChat(opened, 'ada', bao.id), null)
})
