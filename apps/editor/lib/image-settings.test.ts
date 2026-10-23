import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyImageSettingsUpdate, assertImageAddress, readStoredImageSettings, resolveImageSettings, writeStoredImageSettings } from './image-settings'

const none = { provider: '' as const, baseURL: '', model: '', apiKey: '' }

test('nothing is set up until a service, a model and a key are all there', () => {
  assert.equal(resolveImageSettings(none, {}).configured, false)
  assert.equal(resolveImageSettings({ ...none, provider: 'bfl', model: 'flux-pro-1.1' }, {}).configured, false)
  const set = resolveImageSettings({ provider: 'bfl', baseURL: '', model: 'flux-pro-1.1', apiKey: 'k' }, {})
  assert.deepEqual([set.configured, set.baseURL], [true, 'https://api.bfl.ai/v1'])
})

test('the environment fills what is not saved, and what is saved wins', () => {
  const env = { IMAGE_PROVIDER: 'google', IMAGE_MODEL: 'imagen-4.0-generate-001', IMAGE_API_KEY: 'from-env' }
  const fromEnv = resolveImageSettings(none, env)
  assert.deepEqual([fromEnv.provider, fromEnv.model, fromEnv.apiKey, fromEnv.baseURL, fromEnv.configured], ['google', 'imagen-4.0-generate-001', 'from-env', 'https://generativelanguage.googleapis.com/v1beta', true])
  const saved = resolveImageSettings({ provider: 'runware', baseURL: 'https://proxy.example.org/v1', model: 'x:1@1', apiKey: 'saved' }, env)
  assert.deepEqual([saved.provider, saved.baseURL, saved.model, saved.apiKey], ['runware', 'https://proxy.example.org/v1', 'x:1@1', 'saved'])
  assert.equal(resolveImageSettings(none, { IMAGE_PROVIDER: 'nonsense', IMAGE_API_KEY: 'k', IMAGE_MODEL: 'm' }).configured, false)
})

test('one Runware key serves the chat model and the images', () => {
  const chat = { baseURL: 'https://api.runware.ai/v1/', apiKey: 'rw-key' }
  const shared = resolveImageSettings({ provider: 'runware', baseURL: '', model: 'runware:101@1', apiKey: '' }, {}, chat)
  assert.deepEqual([shared.apiKey, shared.configured], ['rw-key', true])
  assert.equal(resolveImageSettings({ provider: 'runware', baseURL: '', model: 'm', apiKey: '' }, {}, { baseURL: 'https://api.openai.com/v1', apiKey: 'sk' }).configured, false, 'another service\'s key is never lent')
  assert.equal(resolveImageSettings({ provider: 'bfl', baseURL: '', model: 'm', apiKey: '' }, {}, chat).configured, false)
})

test('an update keeps the saved key when the key is blank, and an unknown service is no service', () => {
  const stored = { provider: 'openai' as const, baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: 'old' }
  assert.equal(applyImageSettingsUpdate(stored, { provider: 'openai', baseURL: ' https://api.openai.com/v1 ', model: ' gpt-image-1 ', apiKey: '' }).apiKey, 'old')
  assert.equal(applyImageSettingsUpdate(stored, { provider: 'openai', baseURL: '', model: '', apiKey: 'new' }).apiKey, 'new')
  assert.equal(applyImageSettingsUpdate(stored, { provider: 'nonsense', baseURL: '', model: '', apiKey: '' }).provider, '')
  assert.doesNotThrow(() => assertImageAddress(''))
  assert.doesNotThrow(() => assertImageAddress('https://api.together.xyz/v1'))
  assert.throws(() => assertImageAddress('ftp://x'), /http URL/)
  assert.throws(() => assertImageAddress('not a url'), /http URL/)
})

test('the file is private and survives a round trip, and a damaged file is no settings', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-image-settings-')), 'image.json')
  assert.deepEqual(readStoredImageSettings(file), none)
  const stored = { provider: 'google' as const, baseURL: '', model: 'imagen-4.0-generate-001', apiKey: 'secret' }
  writeStoredImageSettings(file, stored)
  assert.deepEqual(readStoredImageSettings(file), stored)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  fs.writeFileSync(file, '{ not json')
  assert.deepEqual(readStoredImageSettings(file), none)
  fs.writeFileSync(file, JSON.stringify({ provider: 'ftp', model: 7 }))
  assert.deepEqual(readStoredImageSettings(file), none)
})
