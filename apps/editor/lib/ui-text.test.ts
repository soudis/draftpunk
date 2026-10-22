import assert from 'node:assert/strict'
import test from 'node:test'
import { EDITOR_LANGUAGES, uiText, type TextKey } from './ui-text'

const POINTS: TextKey[] = ['tips.1', 'tips.2', 'tips.3', 'tips.4']
const EXAMPLES: TextKey[] = ['tips.example.1', 'tips.example.2', 'tips.example.3']

test('the tips are short, in both languages, and name the buttons the editor has', () => {
  for (const { id } of EDITOR_LANGUAGES) {
    assert.equal(POINTS.length, 4)
    for (const key of POINTS) {
      const text = uiText(id, key)
      assert.ok(text.length > 20 && text.length <= 110, `${id} ${key} is ${text.length} characters`)
    }
    for (const key of EXAMPLES) assert.ok(uiText(id, key).trim().length > 15, `${id} ${key}`)
    const all = POINTS.map((key) => uiText(id, key)).join(' ')
    for (const name of ['Edit Mode', 'Undo', 'Publish']) assert.ok(all.includes(name), `${id} names ${name}`)
    assert.notEqual(uiText(id, 'tips.heading'), '')
  }
  assert.notEqual(uiText('de', 'tips.1'), uiText('en', 'tips.1'))
  assert.equal(uiText('de', 'tips.button'), 'Tipps')
  assert.equal(uiText('en', 'tips.button'), 'Tips')
})

test('an example ends where the person has to fill in a detail, or is a request that can be sent as it is', () => {
  assert.ok(uiText('de', 'tips.example.1').endsWith(': '))
  assert.ok(uiText('en', 'tips.example.1').endsWith(': '))
  assert.ok(uiText('de', 'tips.example.3').includes('Sommerfest'))
})
