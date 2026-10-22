import assert from 'node:assert/strict'
import test from 'node:test'
import { addressBlocked, publicLookup, safeFetch } from './safe-fetch'

test('private, local and reserved addresses are blocked', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', 'not-an-address']) {
    assert.equal(addressBlocked(address), true, address)
  }
  for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(addressBlocked(address), false, address)
})

test('a request to a private place fails before anything is sent', async () => {
  for (const url of ['http://127.0.0.1:80/', 'http://localhost/', 'http://printer.local/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'https://user:pw@example.com/', 'http://example.com:8080/', 'ftp://example.com/']) {
    await assert.rejects(() => safeFetch(url), /not a public website/, url)
  }
})

test('a name that points at a private address is refused when the socket connects', async () => {
  const outcome = await new Promise<{ error: NodeJS.ErrnoException | null }>((resolve) => {
    publicLookup('localhost', { all: true }, (error) => resolve({ error }))
  })
  assert.equal(outcome.error?.code, 'EBLOCKED')
})

test('a host gets at most the allowed number of requests at once, and another host is not held up by it', async () => {
  const { HostGate } = await import('./safe-fetch')
  const gate = new HostGate(3)
  let active = 0
  let most = 0
  const task = async () => {
    active += 1
    most = Math.max(most, active)
    await new Promise((resolve) => setTimeout(resolve, 15))
    active -= 1
    return new Response('ok')
  }
  await Promise.all(Array.from({ length: 20 }, () => gate.run('slow.example', task)))
  assert.equal(most, 3)
  const started: string[] = []
  const blocked = gate.run('a.example', async () => {
    started.push('a')
    await new Promise((resolve) => setTimeout(resolve, 40))
    return new Response('a')
  })
  const other = await gate.run('b.example', async () => {
    started.push('b')
    return new Response('b')
  })
  assert.equal(await other.text(), 'b')
  await blocked
  assert.deepEqual(started, ['a', 'b'])
})

test('a host that answers 429 gets fewer requests and a pause, and recovers when it is calm again', async () => {
  const { HostGate } = await import('./safe-fetch')
  const gate = new HostGate(8, 2)
  assert.equal(gate.limitFor('h'), 8)
  await gate.run('h', async () => new Response('slow down', { status: 429, headers: { 'retry-after': '0.15' } }))
  assert.equal(gate.limitFor('h'), 4)
  // The pause is real: the next request waits for it.
  const before = Date.now()
  await gate.run('h', async () => new Response('', { status: 503, headers: { 'retry-after': '0.05' } }))
  assert.ok(Date.now() - before >= 120, `waited ${Date.now() - before} ms`)
  assert.equal(gate.limitFor('h'), 2)
  await gate.run('h', async () => new Response('', { status: 503, headers: { 'retry-after': '0.05' } }))
  assert.equal(gate.limitFor('h'), 2)
  await new Promise((resolve) => setTimeout(resolve, 80))
  for (let index = 0; index < 130; index += 1) await gate.run('h', async () => new Response('ok'))
  assert.equal(gate.limitFor('h'), 8)
})
