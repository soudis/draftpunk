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
  const ada = createChat(opened, 'ada', 'content')
  saveChat(opened, 'ada', ada.id, [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Rewrite the homepage hero' }] }], 'design')
  const listed = listChats(opened, 'ada')
  assert.equal(listed.sessions[0].title, 'Rewrite the homepage hero')
  assert.equal(listed.current.mode, 'design')
  assert.equal(openChat(opened, 'bao', ada.id), null)
  const bao = listChats(opened, 'bao')
  assert.equal(bao.sessions.length, 1)
  assert.notEqual(bao.current.id, ada.id)
  assert.equal(bao.current.messages.length, 0)
})

test('the shared thread is given to the first person who opens the editor', () => {
  const opened = database()
  opened
    .prepare('INSERT INTO thread (id, messages) VALUES (1, ?)')
    .run(JSON.stringify([{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Change the layout' }] }]))
  const first = listChats(opened, 'ada')
  assert.equal(first.current.messages.length, 1)
  assert.equal(first.current.title, 'Change the layout')
  const second = listChats(opened, 'bao')
  assert.equal(second.current.messages.length, 0)
  assert.notEqual(second.current.id, first.current.id)
})

test('the name from the first input stays when a later message is saved', () => {
  const opened = database()
  const ada = createChat(opened, 'ada', 'content')
  const first = [{ id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Rewrite the homepage hero' }] }]
  saveChat(opened, 'ada', ada.id, first, 'content', 'Homepage hero')
  saveChat(opened, 'ada', ada.id, [...first, { id: 'm2', role: 'user', parts: [{ type: 'text', text: 'Now change the contact page' }] }], 'content')
  assert.equal(openChat(opened, 'ada', ada.id)?.title, 'Homepage hero')
})

test('deleting a chat leaves the other person untouched and opens another chat', () => {
  const opened = database()
  const ada = createChat(opened, 'ada', 'content')
  const bao = createChat(opened, 'bao', 'content')
  const removed = deleteChat(opened, 'ada', ada.id)
  assert.ok(removed)
  assert.equal(removed.sessions.some((session) => session.id === ada.id), false)
  assert.equal(openChat(opened, 'bao', bao.id)?.id, bao.id)
  assert.equal(deleteChat(opened, 'ada', bao.id), null)
})
