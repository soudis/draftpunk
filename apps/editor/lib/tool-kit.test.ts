import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { repairToolInput } from './agent'
import { coerceInput, defineTool, inputJsonSchema, ToolError } from './tool-kit'

const call = { toolCallId: 'x', messages: [] as never[] }

const demo = defineTool('demo', {
  description: 'Demo.',
  input: z.object({
    slug: z.string().describe('Required. A slug.'),
    dates: z.array(z.object({ start: z.string() })),
    title: z.union([z.string(), z.record(z.string(), z.string())]),
    note: z.string().optional(),
  }),
  execute: (input) => `ok ${input.slug} ${input.dates.length}`,
})

test('a missing field is named, and the message is short and does not repeat the input', async () => {
  const body = 'wörter '.repeat(500)
  await assert.rejects(
    async () => demo.execute!({ dates: [], title: 'T', note: body } as never, call),
    (error: Error) => {
      assert.ok(error instanceof ToolError)
      assert.match(error.message, /^demo: slug is required\. Nothing was changed\.$/)
      return true
    },
  )
})

test('a list sent as a JSON string is read as a list, and a text field keeps its string', async () => {
  assert.equal(await demo.execute!({ slug: 'a', dates: '[{"start":"2026-01-01"}]', title: '{"de":"x"}' } as never, call), 'ok a 1')
  const coerced = coerceInput(inputJsonSchema(z.object({ title: z.string(), items: z.array(z.string()) })), { title: '[not a list]', items: '["a"]' }) as {
    title: string
    items: string[]
  }
  assert.equal(coerced.title, '[not a list]')
  assert.deepEqual(coerced.items, ['a'])
})

test('an error thrown while running becomes a tool error with the same message', async () => {
  const failing = defineTool('failing', { description: 'x', input: z.object({}), execute: () => { throw new Error('Disk full') } })
  await assert.rejects(async () => failing.execute!({}, call), (error: Error) => error instanceof ToolError && error.message === 'Disk full')
})

test('the schema the model sees is plain JSON schema', () => {
  const schema = inputJsonSchema(z.object({ fields: z.record(z.string(), z.string()) }))
  assert.equal(JSON.stringify(schema).includes('propertyNames'), false)
  assert.equal('$schema' in schema, false)
})

test('arguments in a code fence or encoded twice are repaired, others are not', () => {
  const base = { type: 'tool-call' as const, toolCallId: 'c', toolName: 'write_page' }
  assert.deepEqual(JSON.parse(repairToolInput({ ...base, input: '```json\n{"slug":"a"}\n```' })!.input), { slug: 'a' })
  assert.deepEqual(JSON.parse(repairToolInput({ ...base, input: JSON.stringify('{"slug":"a"}') })!.input), { slug: 'a' })
  assert.deepEqual(JSON.parse(repairToolInput({ ...base, input: 'Here you go: {"slug":"a"} thanks' })!.input), { slug: 'a' })
  assert.equal(repairToolInput({ ...base, input: '{"slug":' }), null)
})
