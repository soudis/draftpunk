import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, listLayoutNames, parseTokens, readLayout, writePage } from '@schlor/generator'
import { lintDesign, newFindings } from './design-lint'
import { addRule, readRules } from './rules'
import { systemPrompt } from './prompt'
import { designTools } from './tools'

const tokens = parseTokens(
  'colors:\n  page: "#ffffff"\n  ink: "#1c1917"\n  primary: "#3f6f64"\n  on-primary: "#ffffff"\n  surface: "#e7e1d5"\nfonts:\n  sans: \'"Source Sans 3", sans-serif\'\n  serif: \'"Source Serif 4", serif\'\n',
)
const call = { toolCallId: 'tokens', messages: [] as never[] }

test('a stylesheet that writes a color value is told which token it is, or the nearest one', () => {
  const found = lintDesign('layouts/room/style.css', '.a { background: #E7E1D5; color: #3f6f6a; border-color: var(--color-primary); box-shadow: 0 1px #00000033; }', tokens)
  assert.deepEqual(found, [
    '#E7E1D5 is the surface color. Use var(--color-surface) in CSS, or bg-surface, text-surface or border-surface in a class.',
    '#3f6f6a is not a token color. The nearest is primary (#3f6f64): use var(--color-primary), or add a color to tokens.yml.',
  ])
  assert.deepEqual(lintDesign('styles.css', 'a { color: var(--color-primary); } /* #123456 */', tokens), [])
})

test('a font that is not a token is named, and generic fonts and variables are fine', () => {
  assert.deepEqual(lintDesign('styles.css', 'h1 { font-family: "Comic Sans MS", cursive; }', tokens), [
    'font-family Comic Sans MS is not a token font. Use font-sans or font-serif (var(--font-sans)), or add the font to tokens.yml.',
  ])
  assert.deepEqual(lintDesign('styles.css', 'a { font-family: "Source Serif 4", serif; } b { font-family: var(--font-sans); } c { font-family: inherit; }', tokens), [])
})

test('a template with a default palette color, an arbitrary color, an inline style, or a hard-coded svg color is told', () => {
  const template = [
    '<div class="bg-red-500 hover:text-blue-600 p-4 bg-[#123456] font-[\'Comic Sans\']" style="color: tomato">x</div>',
    '<svg><path fill="#e7e1d5"></path></svg>',
    '<p style="--gap: 2px">fine</p><div class="bg-primary text-on-primary font-serif"></div>',
  ].join('\n')
  const found = lintDesign('layouts/room/template.njk', template, tokens)
  assert.ok(found.some((line) => /bg-red-500 is a color from the default palette\. Use a token color, such as bg-primary/.test(line)))
  assert.ok(found.some((line) => /hover:text-blue-600 is a color from the default palette/.test(line)))
  assert.ok(found.some((line) => /#123456 is not a token color/.test(line)))
  assert.ok(found.some((line) => /font-\[Comic Sans\] is not a token font/.test(line)))
  assert.ok(found.some((line) => /inline style sets a color, background, or font/.test(line)))
  assert.ok(found.some((line) => /#e7e1d5 is the surface color/.test(line)))
  assert.equal(found.some((line) => /--gap/.test(line)), false)
  assert.deepEqual(lintDesign('layouts/room/template.njk', '<div class="bg-primary text-on-primary font-serif border-surface"></div>', tokens), [])
  assert.deepEqual(lintDesign('nav.yml', 'color: #123456', tokens), [])
  assert.deepEqual(lintDesign('styles.css', 'a { color: #123456 }', parseTokens('')), [])
  assert.deepEqual(newFindings(['a', 'b'], ['b', 'c']), ['c'])
})

test('the starter design follows its own tokens', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-lint-'))
  initSite(root)
  const design = path.join(root, 'design')
  const own = parseTokens(fs.readFileSync(path.join(design, 'tokens.yml'), 'utf8'))
  for (const rel of ['shell.njk', 'styles.css', ...listLayoutNames(design).flatMap((name) => [`layouts/${name}/template.njk`, `layouts/${name}/style.css`])]) {
    assert.deepEqual(lintDesign(rel, fs.readFileSync(path.join(design, rel), 'utf8'), own), [], rel)
  }
})

test('a write that uses a raw color is done, with advice that names the token, and only once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-advice-'))
  initSite(root)
  const tools = designTools(root)
  const layout = {
    name: 'note',
    purpose: 'A note.',
    slots: { body: 'markdown' },
    template: '{% extends "shell.njk" %}{% block body %}<div class="note">{{ slots.body }}</div>{% endblock %}',
    style: '.note { background: #e7e1d5; color: #ff00aa; }\n',
  }
  const first = String(await tools.write_layout.execute!(layout, call))
  assert.match(first, /^Wrote layout note\.\nDesign check \(advice, nothing was refused\):\n- design\/layouts\/note\/style\.css: #e7e1d5 is the surface color\./m)
  assert.match(first, /#ff00aa is not a token color\. The nearest is /)
  assert.ok(fs.existsSync(path.join(root, 'design', 'layouts', 'note')))
  const again = String(await tools.edit_layout.execute!({ name: 'note', part: 'style', find: 'color: #ff00aa;', replace: 'color: #ff00aa; margin: 0;' }, call))
  assert.equal(again.includes('Design check'), false)
  const worse = String(await tools.edit_layout.execute!({ name: 'note', part: 'style', find: 'margin: 0;', replace: 'border-color: #123456;' }, call))
  assert.match(worse, /#123456 is not a token color/)
  assert.equal(worse.includes('#e7e1d5'), false)
  const review = String(await tools.check_design.execute!({}, call))
  assert.match(review, /design\/layouts\/note\/style\.css: #e7e1d5 is the surface color/)
  assert.match(review, /layout note is used by no page/)
})

test('a token file is checked, its color pairs are judged, and the theme follows it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-tokens-'))
  initSite(root)
  const tools = designTools(root)
  await assert.rejects(() => tools.write_design.execute!({ path: 'tokens.yml', content: 'colors:\n  primary: green\n' }, call), /colors\.primary must be a hex color/)
  const original = fs.readFileSync(path.join(root, 'design', 'tokens.yml'), 'utf8')
  assert.equal(fs.readFileSync(path.join(root, 'design', 'tokens.yml'), 'utf8'), original)
  const result = String(await tools.edit_design.execute!({ path: 'tokens.yml', find: 'primary: "#3f6f64"', replace: 'primary: "#9fd3c7"' }, call))
  assert.match(result, /Token check \(advice\): on-primary \(#ffffff\) on primary \(#9fd3c7\) has contrast 1\.\d:1 and needs 4\.5:1\./)
  assert.match(fs.readFileSync(path.join(root, 'dist', 'assets', 'styles.css'), 'utf8'), /--color-primary:\s*#9fd3c7/)
})

test('a rule is kept, once, and shows in the prompt with the tokens', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-rules-'))
  initSite(root)
  assert.deepEqual(readRules(root), [])
  assert.equal(systemPrompt('edit', root).includes('Rules from the person'), false)
  assert.deepEqual(addRule(root, '  Buttons are always   square. '), { rules: ['Buttons are always square.'], added: true })
  assert.deepEqual(addRule(root, 'buttons are always square.'), { rules: ['Buttons are always square.'], added: false })
  addRule(root, '- No full-bleed photos.')
  assert.deepEqual(readRules(root), ['Buttons are always square.', 'No full-bleed photos.'])
  assert.equal(fs.readFileSync(path.join(root, 'design', 'rules.md'), 'utf8'), '# Rules\n- Buttons are always square.\n- No full-bleed photos.\n')
  assert.throws(() => addRule(root, 'No.'), /one clear line/)
  assert.throws(() => addRule(root, 'x'.repeat(200)), /under 180 characters/)
  for (let index = 0; index < 28; index += 1) addRule(root, `Rule number ${index} for the whole site.`)
  assert.throws(() => addRule(root, 'One more rule than there is room for.'), /already 30 rules/)
  const prompt = systemPrompt('edit', root)
  assert.match(prompt, /Rules from the person, for the whole site:\n- Buttons are always square\.\n- No full-bleed photos\./)
  assert.match(prompt, /Design tokens, to use by name:\nColors: page #ffffff, ink #1c1917, muted #57534e/)
  assert.match(prompt, /Fonts: sans "Source Sans 3"/)
  assert.match(prompt, /call add_rule with one short line/)
})

test('a page uses what the layouts and the tokens give it, and the catalog hints at layouts with the same slots', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-hints-'))
  initSite(root)
  const tools = designTools(root)
  const twin = { purpose: 'A note.', slots: { body: 'markdown' }, template: '{% extends "shell.njk" %}{% block body %}{{ slots.body }}{% endblock %}' }
  await tools.write_layout.execute!({ name: 'note-a', ...twin }, call)
  await tools.write_layout.execute!({ name: 'note-b', ...twin }, call)
  writePage(root, { slug: 'a', layout: 'note-a', title: { de: 'A' }, slots: { body: { de: 'Text.' } } })
  const catalog = String(await tools.list_layouts.execute!({}, call))
  assert.match(catalog, /- note-a — A note\.\n {2}slots: body:markdown\n {2}used by: a\n {2}same slots as: note-b/)
  assert.ok(readLayout(path.join(root, 'design'), 'note-a'))
})
