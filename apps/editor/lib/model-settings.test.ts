import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  DEFAULT_MODEL_BASE,
  DEFAULT_MODEL_NAME,
  applyModelSettingsUpdate,
  assertModelBase,
  readStoredModelSettings,
  resolveModelSettings,
  writeStoredModelSettings,
} from './model-settings'

const empty = { baseURL: '', model: '', apiKey: '' }

test('the environment fills gaps, and a stored token wins', () => {
  const env = { LLM_API_KEY: 'env-key', LLM_BASE_URL: 'https://env.example/v1', LLM_MODEL: 'env-model' }
  assert.deepEqual(resolveModelSettings(empty, env), {
    baseURL: 'https://env.example/v1',
    model: 'env-model',
    apiKey: 'env-key',
  })
  assert.equal(resolveModelSettings(empty, {}).baseURL, DEFAULT_MODEL_BASE)
  assert.equal(resolveModelSettings(empty, {}).model, DEFAULT_MODEL_NAME)
  const stored = { baseURL: 'https://api.example/v1', model: 'mine', apiKey: 'file-key' }
  assert.equal(resolveModelSettings(stored, env).apiKey, 'file-key')
  assert.equal(resolveModelSettings(stored, env).baseURL, 'https://api.example/v1')
})

test('a blank token keeps the stored token and a blank address falls back', () => {
  const stored = { baseURL: 'https://api.example/v1', model: 'mine', apiKey: 'file-key' }
  const next = applyModelSettingsUpdate(stored, { baseURL: '', model: '', apiKey: '   ' })
  assert.equal(next.apiKey, 'file-key')
  assert.equal(next.baseURL, '')
  assert.equal(resolveModelSettings(next, {}).baseURL, DEFAULT_MODEL_BASE)
  assert.equal(resolveModelSettings(next, {}).model, DEFAULT_MODEL_NAME)
  assert.throws(() => assertModelBase('ftp://files.example/v1'), /http URL/)
})

test('the settings file round-trips the token without putting it in another field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-model-'))
  const file = path.join(dir, 'model.json')
  writeStoredModelSettings(file, { baseURL: 'https://api.example/v1', model: 'mine', apiKey: 'file-key' })
  const stored = readStoredModelSettings(file)
  assert.equal(stored.apiKey, 'file-key')
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).apiKey, 'file-key')
  assert.equal('token' in JSON.parse(fs.readFileSync(file, 'utf8')), false)
})
