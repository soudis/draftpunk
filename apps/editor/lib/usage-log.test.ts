import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { formatReport, migrateUsage, recordBadCall, recordStep, stepTools, usageReport } from './usage-log'

function open() {
  const database = new Database(':memory:')
  migrateUsage(database)
  return database
}

const step = { sessionId: 's', model: 'm', finishReason: 'tool-calls' }

test('the report counts tokens, cache hits, and failures per tool', () => {
  const database = open()
  recordStep(database, { ...step, turn: 1, step: 1, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 50, tools: [{ name: 'read_page' }] })
  recordStep(database, {
    ...step,
    turn: 1,
    step: 2,
    inputTokens: 1200,
    cachedInputTokens: 1000,
    outputTokens: 400,
    tools: [{ name: 'write_page', error: 'write_page: languages is required. Nothing was changed.' }],
  })
  recordStep(database, { ...step, task: 'content', model: 'small', turn: 2, step: 1, inputTokens: 3000, cachedInputTokens: 2400, outputTokens: 10, tools: [{ name: 'write_page' }] })
  const report = usageReport(database)
  assert.equal(report.turns, 2)
  assert.equal(report.steps, 3)
  assert.equal(report.inputTokens, 5200)
  assert.equal(report.outputTokens, 460)
  assert.equal(report.largestTurnInputTokens, 3000)
  assert.equal(report.toolCalls, 3)
  assert.equal(report.toolFailures, 1)
  assert.equal(report.byTool.find((tool) => tool.name === 'write_page')?.failures, 1)
  assert.equal(Math.round(report.cacheHitRate * 100), 65)
  assert.deepEqual(report.byTask, [
    { task: 'content', model: 'small', steps: 1, inputTokens: 3000, outputTokens: 10 },
    { task: 'unknown', model: 'm', steps: 2, inputTokens: 2200, outputTokens: 450 },
  ])
  assert.match(formatReport(report), /content +small +1 +3000 +10/)
  assert.match(formatReport(report), /1× write_page: write_page: languages is required/)
  assert.equal(usageReport(database, { model: 'other' }).steps, 0)
})

test('a step keeps the full text of a tool failure, up to a limit', () => {
  const tools = stepTools([
    { type: 'text' },
    { type: 'tool-result', toolName: 'read_page' },
    { type: 'tool-error', toolName: 'write_page', error: new Error('x'.repeat(5000)) },
  ])
  assert.deepEqual(tools[0], { name: 'read_page' })
  assert.equal(tools[1].error?.length, 2000)
})

test('a broken tool call keeps the start and the end of what the model wrote', () => {
  const database = open()
  recordBadCall(database, { sessionId: 's', turn: 2, toolName: 'write_page', reason: 'arguments could not be read', raw: '{"slug":"a","title":' })
  recordBadCall(database, { sessionId: 's', turn: 2, toolName: 'write_page', reason: 'arguments could not be read', raw: `{"slug":"b",${'x'.repeat(6000)}CUT` })
  const rows = database.prepare('select tool_name, raw_length, raw_head, raw_tail from bad_calls order by id').all() as { tool_name: string; raw_length: number; raw_head: string; raw_tail: string }[]
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { tool_name: 'write_page', raw_length: 20, raw_head: '{"slug":"a","title":', raw_tail: '' })
  assert.equal(rows[1].raw_length, 6000 + 'CUT'.length + '{"slug":"b",'.length)
  assert.equal(rows[1].raw_head.length, 3000)
  assert.ok(rows[1].raw_tail.endsWith('CUT'))
})
