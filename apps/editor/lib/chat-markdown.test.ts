import assert from 'node:assert/strict'
import test from 'node:test'
import { parseChatMarkdown } from './chat-markdown'

test('chat replies keep emphasis, lists, and links', () => {
  const blocks = parseChatMarkdown('The **header** is now white.\n\n- coral links\n- [schloR](https://schlor.org)\n\n`styles.css`')
  assert.deepEqual(blocks[0], {
    kind: 'p',
    inlines: [{ kind: 'text', text: 'The ' }, { kind: 'strong', children: [{ kind: 'text', text: 'header' }] }, { kind: 'text', text: ' is now white.' }],
  })
  assert.equal(blocks[1]?.kind, 'ul')
  assert.deepEqual(blocks[2], { kind: 'p', inlines: [{ kind: 'code', text: 'styles.css' }] })
  const link = blocks[1]?.kind === 'ul' ? blocks[1].items[1]?.inlines[0] : undefined
  assert.deepEqual(link, { kind: 'a', text: 'schloR', href: 'https://schlor.org/' })
})

test('nested lists keep code inside bold labels', () => {
  const blocks = parseChatMarkdown('1. **`shell.njk`**:\n   - **weekday** in the date\n')
  const item = blocks[0]?.kind === 'ol' ? blocks[0].items[0] : undefined
  assert.deepEqual(item?.inlines, [
    { kind: 'strong', children: [{ kind: 'code', text: 'shell.njk' }] },
    { kind: 'text', text: ':' },
  ])
  assert.equal(item?.nested[0]?.kind, 'ul')
  const nested = item?.nested[0]?.kind === 'ul' ? item.nested[0].items[0]?.inlines[0] : undefined
  assert.deepEqual(nested, { kind: 'strong', children: [{ kind: 'text', text: 'weekday' }] })
})
