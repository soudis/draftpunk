import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MODEL_PROVIDERS,
  addressSuggestions,
  modelAfterProviderPick,
  modelSuggestions,
  modelSupportsVision,
  providerForBase,
} from './model-catalog'

test('an empty address offers the common providers, and a typed fragment narrows them', () => {
  const names = addressSuggestions('').map((provider) => provider.name)
  assert.deepEqual(names, ['OpenAI', 'Google Gemini', 'Anthropic', 'Z.AI', 'Kimi', 'DeepSeek', 'Runware'])
  assert.equal(addressSuggestions('kimi')[0]?.baseURL, 'https://api.moonshot.ai/v1')
  assert.equal(addressSuggestions('https://api.openai.com/v1/').length, names.length)
  assert.equal(providerForBase('https://api.z.ai/api/paas/v4/')?.name, 'Z.AI')
  assert.equal(providerForBase('https://api.runware.ai/v1')?.models[0], 'deepseek:v4@flash')
  assert.equal(modelSupportsVision('https://api.runware.ai/v1', 'google:gemini@3.1-pro'), false, 'not documented, so off unless asked for')
  assert.equal(modelSupportsVision('https://api.runware.ai/v1', 'google:gemini@3.1-pro', '1'), true)
})

test('model suggestions follow the address and a provider pick keeps a matching model', () => {
  const kimi = modelSuggestions('k2.6', 'https://api.openai.com/v1')
  assert.equal(kimi[0]?.model, 'kimi-k2.6')
  assert.equal(kimi[0]?.baseURL, 'https://api.moonshot.ai/v1')
  const geminiFirst = modelSuggestions('', 'https://generativelanguage.googleapis.com/v1beta/openai')
  assert.equal(geminiFirst[0]?.model, 'gemini-3.8-flash')
  const gemini = providerForBase('https://generativelanguage.googleapis.com/v1beta/openai')
  assert.ok(gemini)
  assert.equal(modelAfterProviderPick('gemini-3.1-pro-preview', gemini), 'gemini-3.1-pro-preview')
  assert.equal(modelAfterProviderPick('gpt-4.1', gemini), 'gemini-3.8-flash')
  const byName = Object.fromEntries(MODEL_PROVIDERS.map((provider) => [provider.name, provider.models]))
  assert.ok(byName.OpenAI.includes('gpt-6-astra') && byName.OpenAI.includes('gpt-4o-mini'))
  assert.ok(byName['Google Gemini'].includes('gemini-2.5-pro'))
  assert.ok(byName.Anthropic.includes('claude-fable-5-1') && byName.Anthropic.includes('claude-sonnet-4-6'))
  assert.ok(byName['Z.AI'].includes('glm-4.7') && byName['Z.AI'].includes('glm-4.6v'))
  assert.equal(byName.Kimi.includes('kimi-k2.5'), false)
  assert.ok(byName.Kimi.includes('kimi-k2.7-code'))
})

test('a model reads pictures when its provider says so, and LLM_VISION overrides', async () => {
  const { modelSupportsVision } = await import('./model-catalog')
  assert.equal(modelSupportsVision('https://api.openai.com/v1', 'gpt-4.1'), true)
  assert.equal(modelSupportsVision('https://api.anthropic.com/v1/', 'claude-sonnet-5-5'), true)
  assert.equal(modelSupportsVision('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.8-flash'), true)
  assert.equal(modelSupportsVision('https://api.deepseek.com', 'deepseek-flash'), true)
  assert.equal(modelSupportsVision('https://api.deepseek.com', 'deepseek-v4-pro'), false)
  assert.equal(modelSupportsVision('https://api.z.ai/api/paas/v4', 'glm-4.6v'), true)
  assert.equal(modelSupportsVision('https://api.z.ai/api/paas/v4', 'glm-5.3-flashx'), false)
  assert.equal(modelSupportsVision('https://api.moonshot.ai/v1', 'kimi-k3'), false)
  assert.equal(modelSupportsVision('https://api.moonshot.ai/v1', 'kimi-k3', '1'), true)
  assert.equal(modelSupportsVision('https://api.openai.com/v1', 'gpt-4.1', '0'), false)
})
