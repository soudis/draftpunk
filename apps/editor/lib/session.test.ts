import assert from 'node:assert/strict'
import test from 'node:test'
import { httpsPicture, openSession, sealSession, type EditorSession } from './session'

test('a sealed session opens as the same person', async () => {
  const session: EditorSession = {
    sub: 'person-1',
    name: 'Ada',
    email: 'ada@schlor.org',
    exp: Date.now() + 60_000,
  }
  const token = await sealSession(session, 'test-secret')
  const opened = await openSession(token, 'test-secret')
  assert.equal(opened?.email, 'ada@schlor.org')
  assert.equal(await openSession(token, 'other-secret'), null)
  assert.equal(await openSession(`${token}x`, 'test-secret'), null)
})

test('an https account picture is kept', async () => {
  const session: EditorSession = {
    sub: 'person-1',
    name: 'Ada',
    email: 'ada@schlor.org',
    exp: Date.now() + 60_000,
    picture: 'https://id.example/a.png',
  }
  const opened = await openSession(await sealSession(session, 'test-secret'), 'test-secret')
  assert.equal(opened?.picture, 'https://id.example/a.png')
  assert.equal(httpsPicture('http://id.example/a.png'), undefined)
  const blocked = await openSession(
    await sealSession({ ...session, picture: 'http://id.example/a.png' }, 'test-secret'),
    'test-secret',
  )
  assert.equal(blocked?.picture, undefined)
})
