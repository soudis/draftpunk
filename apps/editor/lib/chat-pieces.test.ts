import assert from 'node:assert/strict'
import test from 'node:test'
import { chatPieces, madePictures } from './chat-pieces'

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

test('the pictures the agent made in a message are shown, once each, and a failed call shows nothing', () => {
  const done = (toolName: string, output: string, state = 'output-available') => ({ type: `tool-${toolName}`, toolName, state, output })
  const made = madePictures([
    done('edit_picture', 'Saved /media/hof-edit.png, made from /media/hof.png by crop. 100 × 100 px.'),
    done('trace_picture', 'Saved /media/logo-trace.svg, traced from /media/logo.png: 1 paths in 1 layer.'),
    done('edit_picture', 'Saved /media/hof-edit.png, made from /media/hof.png by resize. 50 × 50 px.'),
    done('generate_image', 'Saved /media/wiese.png, made by gpt-image-1 (1536x1024). It is a generated picture: tell the person so.'),
    done('write_svg', 'Saved /media/punkt.svg. 2048 × 2048 px.'),
    done('list_pictures', 'Saved /media/nope.png, not a maker'),
    done('edit_picture', 'Saved /media/unfinished.png, x', 'input-available'),
    { type: 'text', text: 'Saved /media/also-not.png, text' },
  ])
  assert.deepEqual(made, [
    { file: 'hof-edit.png', generated: false },
    { file: 'logo-trace.svg', generated: false },
    { file: 'wiese.png', generated: true },
    { file: 'punkt.svg', generated: false },
  ])
  assert.deepEqual(madePictures([]), [])
})
