'use client'

import { uiText, type EditorLanguage } from '@/lib/ui-text'

const POINTS = ['tips.1', 'tips.2', 'tips.3', 'tips.4'] as const
const EXAMPLES = ['tips.example.1', 'tips.example.2', 'tips.example.3'] as const

/**
 * A short card of advice for a chat that has nothing in it yet. It is fixed text, so it costs no model call.
 * An example goes into the message box to be changed, and is not sent.
 */
export function TipsCard({ language, onExample }: { language: EditorLanguage; onExample: (text: string) => void }) {
  return (
    <section className="tips" aria-label={uiText(language, 'tips.heading')}>
      <h2>{uiText(language, 'tips.heading')}</h2>
      <ul>
        {POINTS.map((key) => (
          <li key={key}>{uiText(language, key)}</li>
        ))}
      </ul>
      <p className="tips-label">{uiText(language, 'tips.examples')}</p>
      <div className="chips">
        {EXAMPLES.map((key) => (
          <button key={key} type="button" className="chip" onClick={() => onExample(uiText(language, key))}>
            {uiText(language, key).trim()}
          </button>
        ))}
      </div>
    </section>
  )
}
