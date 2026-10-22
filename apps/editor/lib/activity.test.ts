import assert from 'node:assert/strict'
import test from 'node:test'
import { activityLabel, activityState, savedChange, toolKind, unchangedNote } from './activity'

test('a sent message says what the editor is doing', () => {
  assert.equal(activityLabel([], 'submitted'), 'Thinking…')
  assert.equal(activityLabel([{ role: 'assistant', parts: [{ type: 'text' }] }], 'streaming'), 'Writing…')
  assert.equal(
    activityLabel([{ role: 'assistant', parts: [{ type: 'tool-list_design', state: 'input-available' }] }], 'streaming'),
    'Using list design…',
  )
  assert.equal(activityLabel([], 'ready'), null)
})

test('a saved design file is named, and a read-only run says nothing was saved', () => {
  assert.equal(
    savedChange({ type: 'tool-write_design', state: 'output-available', output: 'Updated design/styles.css. Every page was regenerated.' }),
    'Updated design/styles.css. Every page was regenerated.',
  )
  assert.equal(savedChange({ type: 'tool-read_design', state: 'output-available', output: 'body {}' }), null)
  const reads = [{ type: 'tool-read_website', state: 'output-available', output: 'URL' }]
  assert.equal(unchangedNote(reads, 'ready'), 'Nothing was saved.')
  assert.equal(unchangedNote(reads, 'streaming'), null)
  assert.equal(unchangedNote([...reads, { type: 'text', text: 'The header is now white.' }], 'ready'), null)
})

test('a tool is a read, a change or a check', () => {
  assert.equal(toolKind('read_page'), 'read')
  assert.equal(toolKind('inspect_website'), 'read')
  assert.equal(toolKind('site_map'), 'read')
  assert.equal(toolKind('write_page'), 'change')
  assert.equal(toolKind('add_font'), 'change')
  assert.equal(toolKind('check_design'), 'check')
  assert.equal(toolKind('preview_page'), 'check')
  assert.equal(toolKind('anything_else'), 'other')
  assert.deepEqual(activityState([], 'submitted'), { kind: 'thinking' })
  assert.deepEqual(activityState([{ role: 'assistant', parts: [{ type: 'tool-read_page', state: 'input-available' }] }], 'streaming'), { kind: 'tool', tool: 'read_page' })
  assert.equal(activityState([], 'ready'), null)
})
