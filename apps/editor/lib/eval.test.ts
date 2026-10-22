import assert from 'node:assert/strict'
import test from 'node:test'
import { MockLanguageModelV2 } from 'ai/test'
import { scenarios } from '../evals/scenarios'
import { formatEval, runScenario } from './eval'

type Reply = { calls?: { name: string; input: unknown }[]; text?: string }

// A model that follows a script: each call to the model plays the next reply.
function scripted(replies: Reply[]) {
  let index = 0
  return new MockLanguageModelV2({
    doGenerate: async () => {
      const reply = replies[Math.min(index, replies.length - 1)]
      index += 1
      const calls = reply.calls ?? []
      return {
        content: [
          ...calls.map((call, order) => ({
            type: 'tool-call' as const,
            toolCallId: `call-${index}-${order}`,
            toolName: call.name,
            input: typeof call.input === 'string' ? call.input : JSON.stringify(call.input),
          })),
          ...(reply.text ? [{ type: 'text' as const, text: reply.text }] : []),
        ],
        finishReason: calls.length > 0 ? ('tool-calls' as const) : ('stop' as const),
        usage: { inputTokens: 1000 * index, outputTokens: 100, totalTokens: 1000 * index + 100, cachedInputTokens: 500 * index },
        warnings: [],
      }
    },
  })
}

const contentOnly = scenarios.find((scenario) => scenario.id === 'content-only')!

test('a scenario that does what was asked passes, and the report counts tokens and steps', async () => {
  const model = scripted([
    { calls: [{ name: 'read_page', input: { slug: 'kontakt' } }] },
    {
      calls: [
        {
          name: 'write_page',
          input: {
            slug: 'kontakt',
            layout: 'article',
            languages: {
              de: { title: 'Kontakt', body: 'Ruf uns an: 0660 123 4567.\n\nOder schreib an hallo@example.org.' },
              en: { title: 'Contact', body: 'Call us: 0660 123 4567.\n\nOr write to hallo@example.org.' },
            },
          },
        },
      ],
    },
    { text: 'Die Nummer ist geändert.' },
  ])
  const result = await runScenario(model, contentOnly, { modelName: 'script', prices: { input: 1, cachedInput: 0.1, output: 2 } })
  assert.equal(result.steps, 3)
  assert.equal(result.toolCalls, 2)
  assert.equal(result.toolFailures, 0)
  assert.equal(result.inputTokens, 6000)
  assert.equal(result.cachedInputTokens, 3000)
  assert.equal(result.finalText, 'Die Nummer ist geändert.')
  assert.deepEqual(result.changed.filter((file) => file.startsWith('design/')), [])
  assert.deepEqual(result.checks.filter((check) => !check.ok), [])
  assert.ok(result.cost !== undefined && result.cost > 0)
  assert.match(formatEval([result]), /content-only — script: checks pass/)
})

test('a failed tool call is counted with its message, and a design change fails the content-only checks', async () => {
  const model = scripted([
    { calls: [{ name: 'write_page', input: { slug: 'kontakt', layout: 'article', title: 'Kontakt', body: 'x'.repeat(2000) } }] },
    { calls: [{ name: 'write_design', input: { path: 'styles.css', content: 'body { color: #111; }' } }] },
    { text: 'Fertig.' },
  ])
  const result = await runScenario(model, contentOnly, { modelName: 'script' })
  assert.equal(result.toolFailures, 1)
  assert.match(result.failures[0].error, /languages is required/)
  assert.equal(result.failures[0].error.includes('xxxx'), false)
  const failed = result.checks.filter((check) => !check.ok).map((check) => check.name)
  assert.ok(failed.includes('no design file changed'))
  assert.ok(failed.includes('the new number is on the German page'))
  assert.match(formatEval([result]), /✖ no design file changed/)
})
