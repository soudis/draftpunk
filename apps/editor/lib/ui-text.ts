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
  'tips.button': { de: 'Tipps', en: 'Tips' },
  'tips.close': { de: 'Schließen', en: 'Close' },
  'tips.heading': { de: 'So geht’s', en: 'How it works' },
  'tips.1': {
    de: 'Sagt in eigenen Worten, was sich ändern soll: Texte, Aussehen, Seiten, Termine, Bilder.',
    en: 'Say in your own words what should change: texts, looks, pages, events, pictures.',
  },
  'tips.2': {
    de: 'Mit „Edit Mode“ in der Vorschau klickt ihr einen Satz an und ändert ihn direkt.',
    en: 'With “Edit Mode” in the preview, click a sentence and change it right there.',
  },
  'tips.3': {
    de: 'Gefällt euch eine Website? Fügt den Link ein: Farben und Aufbau übernehme ich, Texte nicht.',
    en: 'Like a website? Paste its link: I take the colors and the structure, not the texts.',
  },
  'tips.4': {
    de: 'Nicht gelungen? „Undo“ steht unter meiner Antwort. Mit „Publish“ geht die Seite online.',
    en: 'Not right? “Undo” sits under my reply. “Publish” puts the site online.',
  },
  'tips.examples': { de: 'Zum Beispiel', en: 'For example' },
  'tips.example.1': { de: 'Ändere die Telefonnummer auf der Kontaktseite: ', en: 'Change the phone number on the contact page: ' },
  'tips.example.2': { de: 'Lege eine neue Seite „Werkstatt“ an, mit einem kurzen Text und zwei Fotos.', en: 'Add a new page “Workshop”, with a short text and two photos.' },
  'tips.example.3': { de: 'Trage einen Termin ein: Sommerfest am 5. Juli um 16 Uhr im Hof.', en: 'Add an event: summer party on 5 July at 4 pm in the courtyard.' },
} as const

export type TextKey = keyof typeof TEXTS

/** A text in a language, with {name} filled in from values. */
export function uiText(language: EditorLanguage, key: TextKey, values: Record<string, string | number> = {}): string {
  return TEXTS[key][language].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
}
