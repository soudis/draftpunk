'use client'

import { useState } from 'react'
import { buildSetupMessage, canGoOn, visibleQuestions, type Answers, type Question } from '@/lib/setup-questions'
import { uiText, type EditorLanguage } from '@/lib/ui-text'

function Choice({ question, answer, onAnswer, language }: { question: Question; answer: string; onAnswer: (value: string) => void; language: EditorLanguage }) {
  const options = question.options ?? []
  const picked = question.kind === 'many' ? answer.split(', ').filter(Boolean) : [answer]
  const toggle = (option: string) => {
    if (question.kind === 'many') {
      const next = picked.includes(option) ? picked.filter((item) => item !== option) : [...picked, option]
      onAnswer(next.join(', '))
      return
    }
    onAnswer(answer === option ? '' : option)
  }
  const own = question.kind === 'many' ? picked.filter((item) => !options.includes(item)).join(', ') : options.includes(answer) ? '' : answer
  return (
    <>
      <div className="chips" role={question.kind === 'many' ? 'group' : 'radiogroup'}>
        {options.map((option) => (
          <button key={option} type="button" className="chip" aria-pressed={picked.includes(option)} onClick={() => toggle(option)}>
            {option}
          </button>
        ))}
      </div>
      {!question.closed && (
        <label className="own-words">
          {uiText(language, 'setup.other')}
          <input
            value={own}
            placeholder={question.placeholder}
            onChange={(event) => {
              const text = event.target.value
              onAnswer(question.kind === 'many' ? [...picked.filter((item) => options.includes(item)), ...(text ? [text] : [])].join(', ') : text)
            }}
          />
        </label>
      )}
    </>
  )
}

/**
 * The first thing a fresh site shows. The questions are fixed, so asking them costs nothing and needs no model.
 * The answers become one message, and the setup goes on from there.
 */
export function SetupStart({
  language,
  disabled,
  onSend,
  onSkip,
  skipError,
}: {
  language: EditorLanguage
  disabled: boolean
  onSend: (message: string) => void
  onSkip: () => void
  skipError: string
}) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const questions = visibleQuestions(language, answers)
  const reviewing = step >= questions.length
  const question = questions[step]
  const answer = question ? (answers[question.id] ?? '') : ''
  const set = (value: string) => question && setAnswers((current) => ({ ...current, [question.id]: value }))

  return (
    <section className="setup-start" aria-label={uiText(language, 'setup.heading')}>
      <h2>{uiText(language, 'setup.heading')}</h2>
      {step === 0 && <p className="setup-intro">{uiText(language, 'setup.intro')}</p>}
      {!reviewing && question && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (canGoOn(question, answer)) setStep(step + 1)
          }}
        >
          <p className="setup-progress">
            {uiText(language, 'setup.progress', { step: step + 1, total: questions.length })}
            {!question.required && <span> · {uiText(language, 'setup.optional')}</span>}
          </p>
          <h3>{question.title}</h3>
          {question.help && <p className="setup-help">{question.help}</p>}
          {question.kind === 'line' && <input autoFocus value={answer} placeholder={question.placeholder} onChange={(event) => set(event.target.value)} />}
          {question.kind === 'text' && <textarea autoFocus rows={4} value={answer} onChange={(event) => set(event.target.value)} />}
          {(question.kind === 'one' || question.kind === 'many') && <Choice question={question} answer={answer} onAnswer={set} language={language} />}
          <div className="setup-actions">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)}>
                {uiText(language, 'setup.back')}
              </button>
            )}
            {!question.required && (
              <button type="button" className="quiet" onClick={() => { set(''); setStep(step + 1) }}>
                {uiText(language, 'setup.skipQuestion')}
              </button>
            )}
            <button type="submit" className="primary" disabled={!canGoOn(question, answer)}>
              {uiText(language, 'setup.next')}
            </button>
          </div>
        </form>
      )}
      {reviewing && (
        <div>
          <h3>{uiText(language, 'setup.review')}</h3>
          <dl className="setup-review">
            {questions.map((item, index) => (
              <div key={item.id}>
                <dt>
                  <button type="button" className="quiet" onClick={() => setStep(index)}>
                    {item.title}
                  </button>
                </dt>
                <dd>{(answers[item.id] ?? '').trim() || uiText(language, 'setup.nothing')}</dd>
              </div>
            ))}
          </dl>
          <div className="setup-actions">
            <button type="button" onClick={() => setStep(questions.length - 1)}>
              {uiText(language, 'setup.back')}
            </button>
            <button type="button" className="primary" disabled={disabled} onClick={() => onSend(buildSetupMessage(answers, language))}>
              {uiText(language, 'setup.start')}
            </button>
          </div>
        </div>
      )}
      <p className="setup-skip">
        <button type="button" className="quiet" disabled={disabled} onClick={onSkip}>
          {uiText(language, 'setup.skip')}
        </button>
      </p>
      {skipError && <p className="picture-error">{skipError}</p>}
    </section>
  )
}
