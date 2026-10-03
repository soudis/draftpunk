import assert from 'node:assert/strict'
import test from 'node:test'
import { activityLabel, savedChange, unchangedNote } from './activity'

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
