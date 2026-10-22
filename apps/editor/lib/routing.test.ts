import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyRequest, planRequest } from './routing'
import { needsReasoningPassBack, shapeRequestBody, thinkingParams } from './thinking'
import { pruneHistory } from './history'
import { modelFor } from './provider'
import { resolveModelSettings } from './model-settings'
import type { ModelMessage } from 'ai'

const ask = (text: string) => [{ role: 'user', parts: [{ type: 'text', text }] }]

test('a request that clearly changes words, facts or pages is content work, and anything about the look is not', () => {
  for (const text of [
    'Die Telefonnummer auf der Kontaktseite ist jetzt 0660 123 4567.',
    'Ändere den Titel der Seite Werkstatt in Werkstatt & Fahrräder',
    'Please replace the opening hours on the contact page',
    'Fix the typo in the second paragraph',
    'Lösche alle News die älter als 6 Monate sind',
    'Füge den Termin Sommerfest am 5. Juli hinzu',
    'Übersetze die Mitmachen Seite ins Englische',
  ]) {
    assert.equal(classifyRequest(ask(text), 'edit'), 'content', text)
  }
  for (const text of [
    'Mach die Veranstaltungsraum Seite schöner',
    'Make the header darker and the text bigger',
    'Der Hero auf der Startseite ist fad',
    'Ändere die Farbe der Buttons',
    'Change the layout of the contact page and replace the text',
    'Mach die Seite so wie https://www.example.org/',
    'Ich mag keine Schatten, nie wieder',
    'mach weiter',
    'ja',
    '',
  ]) {
    assert.equal(classifyRequest(ask(text), 'edit'), 'design', text)
  }
  assert.equal(classifyRequest(ask('Ändere die Telefonnummer'), 'setup'), 'setup')
  const thread = [...ask('Erste Frage zum Design'), { role: 'assistant', parts: [{ type: 'text', text: 'Fertig.' }] }, ...ask('Ändere die Telefonnummer')]
  assert.equal(classifyRequest(thread, 'edit'), 'content')
})

test('a plain text edit gets the cheaper model and no thinking, and everything else the main model', () => {
  const settings = { model: 'big', contentModel: 'small', thinking: 'auto' as const }
  assert.deepEqual(planRequest(settings, 'content'), { task: 'content', model: 'small', thinking: 'off' })
  assert.deepEqual(planRequest(settings, 'design'), { task: 'design', model: 'big', thinking: 'default' })
  assert.deepEqual(planRequest(settings, 'setup'), { task: 'setup', model: 'big', thinking: 'default' })
  assert.deepEqual(planRequest({ ...settings, contentModel: '' }, 'content'), { task: 'content', model: 'big', thinking: 'off' })
  assert.deepEqual(planRequest({ ...settings, thinking: 'off' }, 'design'), { task: 'design', model: 'big', thinking: 'off' })
  assert.deepEqual(planRequest({ ...settings, thinking: 'default' }, 'content'), { task: 'content', model: 'small', thinking: 'default' })
})

test('settings carry the second model and the thinking policy, and a second model equal to the first is none', () => {
  const stored = { baseURL: '', model: 'm', apiKey: 'k', contentModel: 's' }
  const resolved = resolveModelSettings(stored, { LLM_THINKING: 'off' })
  assert.equal(resolved.contentModel, 's')
  assert.equal(resolved.thinking, 'off')
  assert.equal(resolveModelSettings({ ...stored, contentModel: 'm' }, {}).contentModel, '')
  assert.equal(resolveModelSettings({ ...stored, contentModel: '' }, { LLM_CONTENT_MODEL: 'cheap' }).contentModel, 'cheap')
  assert.equal(resolveModelSettings(stored, {}).thinking, 'auto')
})

test('thinking is switched off the way each provider asks, and left alone where that is not known', () => {
  assert.deepEqual(thinkingParams('https://api.deepseek.com', 'deepseek-flash', 'off'), { thinking: { type: 'disabled' } })
  assert.deepEqual(thinkingParams('https://api.z.ai/api/paas/v4/', 'glm-5.3-flashx', 'off'), { thinking: { type: 'disabled' } })
  assert.deepEqual(thinkingParams('https://api.openai.com/v1', 'gpt-5.4-mini', 'off'), { reasoning_effort: 'minimal' })
  assert.deepEqual(thinkingParams('https://api.openai.com/v1', 'gpt-4.1', 'off'), {})
  assert.deepEqual(thinkingParams('https://api.moonshot.ai/v1', 'kimi-k3', 'off'), {})
  assert.deepEqual(thinkingParams('https://api.deepseek.com', 'deepseek-flash', 'default'), {})
})

test('DeepSeek in thinking mode gets an empty chain of thought for an assistant message that has none, and only then', () => {
  const body = {
    tools: [{ type: 'function' }],
    messages: [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'assistant', content: '', tool_calls: [], reasoning_content: 'because' },
    ],
  }
  const shaped = shapeRequestBody(body, { baseURL: 'https://api.deepseek.com', model: 'deepseek-flash', thinking: 'default' })
  assert.deepEqual(shaped.messages.map((message) => message.reasoning_content), [undefined, '', 'because'])
  assert.equal(needsReasoningPassBack('https://api.deepseek.com'), true)
  assert.equal(needsReasoningPassBack('https://api.openai.com/v1'), false)
  const off = shapeRequestBody(body, { baseURL: 'https://api.deepseek.com', model: 'deepseek-flash', thinking: 'off' })
  assert.deepEqual((off as { thinking?: unknown }).thinking, { type: 'disabled' })
  assert.equal(off.messages[1].reasoning_content, undefined)
  const other = shapeRequestBody(body, { baseURL: 'https://api.openai.com/v1', model: 'gpt-4.1', thinking: 'default' })
  assert.equal(other.messages[1].reasoning_content, undefined)
  const noTools = shapeRequestBody({ messages: body.messages }, { baseURL: 'https://api.deepseek.com', model: 'deepseek-flash', thinking: 'default' })
  assert.equal(noTools.messages[1].reasoning_content, undefined)
})

test('the chain of thought of earlier turns is kept for a provider that needs it back, and dropped otherwise', () => {
  const turn = (id: string): ModelMessage[] => [
    { role: 'user', content: `Request ${id}` },
    { role: 'assistant', content: [{ type: 'reasoning', text: `think ${id}` }, { type: 'text', text: `Done ${id}` }] },
  ]
  const messages = [...turn('1'), ...turn('2')]
  assert.equal(JSON.stringify(pruneHistory(messages)).includes('think 1'), false)
  const kept = JSON.stringify(pruneHistory(messages, undefined, { keepReasoning: true }))
  assert.ok(kept.includes('think 1') && kept.includes('think 2'))
  const squeezed = JSON.stringify(pruneHistory([...turn('1'), ...turn('2'), ...turn('3')], 100, { keepReasoning: true }))
  assert.ok(squeezed.includes('think 1') && squeezed.includes('Done 1'))
})

test('the request that goes to the provider carries what the plan asks for', async () => {
  const sent: Record<string, unknown>[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  try {
    const { generateText } = await import('ai')
    const settings = { baseURL: 'https://api.deepseek.com', apiKey: 'k' }
    await generateText({ model: modelFor(settings, { task: 'content', model: 'deepseek-flash', thinking: 'off' }), prompt: 'hi' })
    await generateText({ model: modelFor(settings, { task: 'design', model: 'deepseek-flash', thinking: 'default' }), prompt: 'hi' })
  } finally {
    globalThis.fetch = realFetch
  }
  assert.deepEqual(sent[0].thinking, { type: 'disabled' })
  assert.equal(sent[0].model, 'deepseek-flash')
  assert.equal('thinking' in sent[1], false)
})

test('with DeepSeek the chain of thought of a tool step goes back with the next step, through the real tool loop', async () => {
  const sent: { messages: { role: string; reasoning_content?: unknown; tool_calls?: unknown }[] }[] = []
  const replies = [
    { role: 'assistant', content: '', reasoning_content: 'I should read the page first.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_it', arguments: '{}' } }] },
    { role: 'assistant', content: 'Done.', reasoning_content: 'Now I can answer.' },
  ]
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)))
    const message = replies[sent.length - 1]
    return new Response(
      JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  try {
    const { generateText, stepCountIs, tool } = await import('ai')
    const { z } = await import('zod')
    await generateText({
      model: modelFor({ baseURL: 'https://api.deepseek.com', apiKey: 'k' }, { task: 'design', model: 'deepseek-flash', thinking: 'default' }),
      tools: { read_it: tool({ description: 'x', inputSchema: z.object({}), execute: async () => 'page text' }) },
      stopWhen: stepCountIs(4),
      messages: [
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: 'Earlier answer without any thinking' },
        { role: 'user', content: 'Read the page' },
      ],
    })
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(sent.length, 2)
  const second = sent[1].messages
  const withTools = second.find((message) => message.role === 'assistant' && message.tool_calls)
  assert.equal(withTools?.reasoning_content, 'I should read the page first.')
  const earlier = second.find((message) => message.role === 'assistant' && !message.tool_calls)
  assert.equal(earlier?.reasoning_content, '')
})
