import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, setupAccepted } from '@schlor/generator'
import { ensureGit, git } from './git'
import { systemPrompt } from './prompt'
import { buildSetupMessage, canGoOn, setupQuestions, visibleQuestions } from './setup-questions'
import { skipSetup } from './setup-start'
import { parseEditorLanguage, uiText } from './ui-text'

const author = { name: 'Ada', email: 'ada@schlor.org' }

test('the setup has ten short questions, and only the name and the description have to be answered', () => {
  for (const language of ['de', 'en'] as const) {
    const questions = setupQuestions(language)
    assert.deepEqual(questions.map((question) => question.id), ['name', 'source', 'take', 'scope', 'about', 'languages', 'look', 'sections', 'calendar', 'contact'])
    assert.deepEqual(questions.filter((question) => question.required).map((question) => question.id), ['name', 'about'])
    for (const question of questions) assert.ok(question.title.length > 5, question.id)
    assert.ok(questions.find((question) => question.id === 'sections')?.options?.length)
  }
  assert.equal(setupQuestions('de')[0].title, 'Wie heißt euer Projekt?')
  assert.equal(setupQuestions('en')[0].title, 'What is your project called?')
  const name = setupQuestions('de')[0]
  const languages = setupQuestions('de').find((question) => question.id === 'languages')!
  assert.equal(canGoOn(name, '  '), false)
  assert.equal(canGoOn(name, 'SchloR'), true)
  assert.equal(canGoOn(languages, undefined), true)
})

test('the questions about an existing website appear only when they make sense', () => {
  const ids = (language: 'de' | 'en', answers: Parameters<typeof visibleQuestions>[1]) => visibleQuestions(language, answers).map((question) => question.id)
  assert.deepEqual(ids('de', {}), ['name', 'source', 'about', 'languages', 'look', 'sections', 'calendar', 'contact'])
  assert.deepEqual(ids('de', { source: 'https://schlor.org' }), ['name', 'source', 'take', 'about', 'languages', 'look', 'sections', 'calendar', 'contact'])
  assert.deepEqual(ids('de', { source: 'https://schlor.org', take: 'Die Texte, Die Bilder' }), ['name', 'source', 'take', 'scope', 'about', 'languages', 'look', 'sections', 'calendar', 'contact'])
  assert.deepEqual(ids('en', { source: 'https://schlor.org', take: 'The look' }), ['name', 'source', 'take', 'about', 'languages', 'sections', 'calendar', 'contact'])
  assert.deepEqual(ids('en', { source: ' ', take: 'The look, The texts' }), ['name', 'source', 'about', 'languages', 'look', 'sections', 'calendar', 'contact'])
  const closed = visibleQuestions('de', { source: 'https://x.org', take: 'Die Texte' }).filter((question) => question.closed).map((question) => question.id)
  assert.deepEqual(closed, ['take', 'scope', 'calendar'])
})

test('an answer that no longer applies is left out of the message', () => {
  const message = buildSetupMessage(
    { name: 'Hall', about: 'A hall.', source: 'https://hall.example', take: 'The texts, The pictures', scope: 'Every page and post', look: 'bold and modern' },
    'en',
  )
  assert.equal(
    message,
    [
      'Set up the website. These are my answers:',
      '- Project name: Hall',
      '- Existing website: https://hall.example',
      '- Take from it: The texts, The pictures',
      '- How much: Every page and post',
      '- The project: A hall.',
      '- Model site or mood: bold and modern',
    ].join('\n'),
  )
  const dropped = buildSetupMessage({ name: 'Hall', about: 'A hall.', take: 'The texts', scope: 'Every page and post' }, 'en')
  assert.equal(dropped, 'Set up the website. These are my answers:\n- Project name: Hall\n- The project: A hall.')
})

test('the answers become one message in the language of the editor, without the questions left out', () => {
  const message = buildSetupMessage(
    {
      name: 'SchloR',
      about: 'Ein selbstverwaltetes Haus\nin Wien.',
      languages: 'Deutsch und Englisch (Englisch darf fehlen)',
      look: 'https://schlor.org',
      sections: 'Über uns, Räume, Kontakt',
      calendar: 'Ja',
      contact: '  ',
    },
    'de',
  )
  assert.equal(
    message,
    [
      'Richte die Website ein. Das sind meine Antworten:',
      '- Projektname: SchloR',
      '- Das Projekt: Ein selbstverwaltetes Haus in Wien.',
      '- Sprachen: Deutsch und Englisch (Englisch darf fehlen)',
      '- Vorbild oder Stimmung: https://schlor.org',
      '- Bereiche: Über uns, Räume, Kontakt',
      '- Kalender: Ja',
    ].join('\n'),
  )
  assert.equal(buildSetupMessage({ name: 'Hall', about: 'A hall.' }, 'en'), 'Set up the website. These are my answers:\n- Project name: Hall\n- The project: A hall.')
})

test('the editor speaks German until English is chosen, and a text fills in its values', () => {
  assert.equal(parseEditorLanguage(null), 'de')
  assert.equal(parseEditorLanguage('fr'), 'de')
  assert.equal(parseEditorLanguage('en'), 'en')
  assert.equal(uiText('de', 'setup.progress', { step: 2, total: 7 }), 'Frage 2 von 7')
  assert.equal(uiText('en', 'setup.progress', { step: 2, total: 7 }), 'Question 2 of 7')
  assert.equal(uiText('en', 'setup.skip'), 'Skip and start from the plain starter')
})

test('skipping the setup keeps the starter, calls setup done, and saves that as a change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-skip-'))
  ensureGit(root, author)
  assert.equal(setupAccepted(root), false)
  const home = fs.readFileSync(path.join(root, 'content', 'pages', 'home.yml'), 'utf8')
  assert.deepEqual(skipSetup(root, author), { skipped: true })
  assert.equal(setupAccepted(root), true)
  assert.equal(fs.readFileSync(path.join(root, 'content', 'pages', 'home.yml'), 'utf8'), home)
  assert.equal(git(root, ['log', '-1', '--format=%s']).trim(), 'Start from the plain starter')
  assert.equal(git(root, ['log', '-1', '--format=%an']).trim(), 'Ada')
  assert.deepEqual(skipSetup(root, author), { skipped: false })
  initSite(fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-skip2-')))
})

test('the setup prompt knows what the first message holds and never asks for the published address', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-setup-prompt-'))
  initSite(root)
  const setup = systemPrompt('setup', root)
  assert.match(setup, /The first message may list the person's answers to a few short questions/)
  assert.match(setup, /The project name is site\.name/)
  assert.match(setup, /ask nothing they already answered/)
  assert.match(setup, /The deployment supplies it, so never ask for it/)
  assert.equal(systemPrompt('edit', root).includes('The first message may list'), false)
})
