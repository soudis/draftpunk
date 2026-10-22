import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, recordProposal, writeYaml } from '@schlor/generator'
import { proposalAccepts } from './eval'
import { designTools } from './tools'

const call = { toolCallId: 'labels', messages: [] as never[] }

function newSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-proposal-'))
  initSite(root)
  return root
}

const GOOD = {
  site: { name: 'SchloR' },
  tokens: { colors: { page: '#ffffff', ink: '#233452', primary: '#317c84', 'on-primary': '#ffffff' } },
  layouts: [
    { name: 'note', purpose: 'A note.', slots: { body: 'markdown' }, template: '{% extends "shell.njk" %}{% block body %}<div class="bg-primary text-on-primary">{{ slots.body }}</div><a>{{ labels.more }}</a>{% endblock %}' },
  ],
  labels: { more: { de: 'Mehr', en: 'More' } },
  pages: [{ slug: 'notiz', layout: 'note', title: { de: 'Notiz' }, slots: { body: { de: 'Ein Satz.' } } }],
}

test('a recorded proposal that can be accepted passes every check, and the site stays as it was', () => {
  const root = newSite()
  const before = fs.readFileSync(path.join(root, 'design', 'labels.yml'), 'utf8')
  recordProposal(root, GOOD)
  const checks = proposalAccepts(root)
  assert.deepEqual(checks.filter((check) => !check.ok), [])
  assert.ok(checks.length >= 8)
  assert.equal(fs.readFileSync(path.join(root, 'design', 'labels.yml'), 'utf8'), before)
  assert.equal(fs.existsSync(path.join(root, 'design', 'layouts', 'note')), false)
})

test('a proposal with no recording, or one that cannot be accepted, or one with a label that is missing, fails a named check', () => {
  const empty = newSite()
  assert.deepEqual(proposalAccepts(empty).map((check) => [check.name, check.ok]), [['a proposal was recorded', false]])

  const broken = newSite()
  writeYaml(path.join(broken, 'design', 'proposal.yml'), { pages: [{ slug: 'x', layout: 'nope', title: { de: 'X' }, slots: {} }] })
  const failed = proposalAccepts(broken).find((check) => !check.ok && check.name === 'the proposal can be accepted')
  assert.match(failed?.detail ?? '', /layout nope, which does not exist/)

  const unlabeled = newSite()
  recordProposal(unlabeled, { ...GOOD, labels: undefined })
  const warning = proposalAccepts(unlabeled).find((check) => !check.ok)
  assert.match(warning?.detail ?? '', /labels used by templates but not in design\/labels\.yml.*more/)
})

test('text sent for a part of the proposal in an earlier run is read at accept time, so an old recording still applies', () => {
  const root = newSite()
  writeYaml(path.join(root, 'design', 'proposal.yml'), { ...GOOD, labels: 'more:\n  de: Mehr\n  en: More\n' })
  assert.deepEqual(proposalAccepts(root).filter((check) => !check.ok), [])
})

test('a layout that shows a label the site does not have is told so, and labels.yml must hold named labels', async () => {
  const root = newSite()
  const tools = designTools(root)
  const result = String(
    await tools.write_layout.execute!(
      { name: 'note', purpose: 'A note.', slots: { body: 'markdown' }, template: '{% extends "shell.njk" %}{% block body %}{{ slots.body }}{{ labels.news }}{{ labels.gone }}{% endblock %}' },
      call,
    ),
  )
  assert.match(result, /Labels gone are not in design\/labels\.yml, so they show nothing\./)
  assert.equal(result.includes('Labels news'), false)
  await assert.rejects(() => tools.write_design.execute!({ path: 'labels.yml', content: '0: a\n1: b\n' }, call), /Label name 0 must be lowercase words|Label 0 must be an object/)
  await assert.rejects(() => tools.write_design.execute!({ path: 'labels.yml', content: 'more: Mehr\n' }, call), /Label more must be an object with one text per language/)
  const ok = String(await tools.write_design.execute!({ path: 'labels.yml', content: 'gone:\n  de: Weg\n  en: Gone\n' }, call))
  assert.match(ok, /Updated design\/labels\.yml/)
})
