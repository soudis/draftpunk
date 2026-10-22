// The texts of the editor in the two languages it speaks. German is the default.
export type EditorLanguage = 'de' | 'en'

export const EDITOR_LANGUAGES: { id: EditorLanguage; label: string }[] = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
]

export function parseEditorLanguage(value: string | null | undefined): EditorLanguage {
  return value === 'en' ? 'en' : 'de'
}

const TEXTS = {
  'language.label': { de: 'Sprache des Editors', en: 'Editor language' },
  'setup.heading': { de: 'Richten wir eure Website ein', en: 'Let us set up your website' },
  'setup.intro': {
    de: 'Ein paar kurze Fragen, dann mache ich einen Vorschlag. Ihr könnt ihn danach noch ändern.',
    en: 'A few short questions, then I make a proposal. You can still change it afterwards.',
  },
  'setup.progress': { de: 'Frage {step} von {total}', en: 'Question {step} of {total}' },
  'setup.next': { de: 'Weiter', en: 'Next' },
  'setup.back': { de: 'Zurück', en: 'Back' },
  'setup.skipQuestion': { de: 'Überspringen', en: 'Skip this question' },
  'setup.optional': { de: 'freiwillig', en: 'optional' },
  'setup.other': { de: 'Oder in eigenen Worten', en: 'Or in your own words' },
  'setup.review': { de: 'Das habe ich verstanden', en: 'This is what I understood' },
  'setup.start': { de: 'Einrichtung starten', en: 'Start the setup' },
  'setup.skip': { de: 'Überspringen und mit der schlichten Vorlage starten', en: 'Skip and start from the plain starter' },
  'setup.skipping': { de: 'Einen Moment …', en: 'One moment …' },
  'setup.skipFailed': { de: 'Das Überspringen hat nicht geklappt.', en: 'Skipping did not work.' },
  'setup.nothing': { de: '(nicht beantwortet)', en: '(not answered)' },
} as const

export type TextKey = keyof typeof TEXTS

/** A text in a language, with {name} filled in from values. */
export function uiText(language: EditorLanguage, key: TextKey, values: Record<string, string | number> = {}): string {
  return TEXTS[key][language].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
}
