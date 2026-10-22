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
