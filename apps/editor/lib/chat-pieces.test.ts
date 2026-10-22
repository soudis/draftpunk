import assert from 'node:assert/strict'
import test from 'node:test'
import { chatPieces } from './chat-pieces'

test('repeated tool uses and file updates collapse into groups', () => {
  const pieces = chatPieces([
    { type: 'tool-read_design', state: 'output-available' },
    { type: 'tool-read_website', state: 'output-available' },
    { type: 'tool-write_design', state: 'output-available', output: 'Updated design/styles.css. Every page was regenerated.' },
    { type: 'tool-write_design', state: 'output-available', output: 'Updated design/shell.njk. Every page was regenerated.' },
    { type: 'text', text: 'The header is now white.' },
  ])
  assert.deepEqual(pieces, [
    { kind: 'tools', entries: [{ label: 'Read design', done: true }, { label: 'Read website', done: true }] },
    {
      kind: 'saves',
      lines: ['Updated design/styles.css. Every page was regenerated.', 'Updated design/shell.njk. Every page was regenerated.'],
    },
    { kind: 'text', text: 'The header is now white.' },
  ])
})

test('a tool call that the model wrote as text is not shown', () => {
  const pieces = chatPieces([
    { type: 'text', text: 'Ich prüfe die Seite. <｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="preview_page">' },
    { type: 'text', text: '<｜｜DSML｜｜ calls>' },
  ])
  assert.deepEqual(pieces, [{ kind: 'text', text: 'Ich prüfe die Seite.' }])
})
