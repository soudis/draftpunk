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
  'bar.page': { de: 'Seite', en: 'Page' },
  'bar.pageNone': { de: 'Andere Seite', en: 'Other page' },
  'bar.device': { de: 'Vorschau', en: 'Preview' },
  'bar.desktop': { de: 'Computer', en: 'Desktop' },
  'bar.phone': { de: 'Handy', en: 'Phone' },
  'bar.publish': { de: 'Veröffentlichen', en: 'Publish' },
  'bar.changesOne': { de: '1 Änderung', en: '1 change' },
  'bar.changesMany': { de: '{count} Änderungen', en: '{count} changes' },
  'bar.noChanges': { de: 'Alles veröffentlicht', en: 'All published' },
  'bar.more': { de: 'Mehr', en: 'More' },
  'bar.revert': { de: 'Entwurf zurücksetzen', en: 'Revert draft' },
  'bar.settings': { de: 'Einstellungen', en: 'Settings' },
  'bar.account': { de: 'Konto', en: 'Account' },
  'bar.logout': { de: 'Abmelden', en: 'Log out' },
  'preview.editMode': { de: 'Edit Mode', en: 'Edit Mode' },
  'preview.editHint': { de: 'Klickt einen Text an und ändert ihn. Links bleiben, solange das an ist.', en: 'Click a text and change it. Links stay put while this is on.' },
  'preview.reload': { de: 'Neu laden', en: 'Reload' },
  'composer.placeholder': { de: 'Was soll sich ändern?', en: 'What should change?' },
  'composer.placeholderSetup': { de: 'Beschreibt das Projekt oder fügt eine Website ein, die euch gefällt', en: 'Describe the project, or paste a website you like' },
  'composer.send': { de: 'Senden', en: 'Send' },
  'composer.working': { de: 'Arbeitet …', en: 'Working …' },
  'composer.hint': { de: 'Enter sendet, Umschalt+Enter macht eine neue Zeile', en: 'Enter sends, Shift+Enter starts a new line' },
  'notice.published': { de: 'Veröffentlicht.', en: 'Published.' },
  'notice.reverted': { de: 'Der Entwurf ist zurückgesetzt.', en: 'The draft is reverted.' },
  'notice.needToken': { de: 'Speichert erst einen Token in den Einstellungen.', en: 'Save a token in Settings before sending.' },
  'publish.title': { de: 'Veröffentlichen', en: 'Publish' },
  'publish.nothing': { de: 'Es gibt nichts zu veröffentlichen.', en: 'Nothing would be published.' },
  'publish.gaps': { de: '{count} Pflichttexte sind noch leer. {sample}', en: '{count} required texts are still empty. {sample}' },
  'publish.off': { de: 'Veröffentlichen ist aus, bis der öffentliche Server eingeschaltet ist.', en: 'Publish stays off until the public host is switched on.' },
  'publish.confirm': { de: 'Jetzt veröffentlichen', en: 'Publish now' },
  'revert.title': { de: 'Entwurf zurücksetzen', en: 'Revert draft' },
  'revert.text': {
    de: 'Der Entwurf geht zurück auf die öffentliche Seite. Alle unveröffentlichten Änderungen gehen verloren, auch die von anderen.',
    en: 'This puts the draft back to the public site and discards every unpublished change, including other people’s.',
  },
  'modal.cancel': { de: 'Abbrechen', en: 'Cancel' },
} as const

export type TextKey = keyof typeof TEXTS

/** A text in a language, with {name} filled in from values. */
export function uiText(language: EditorLanguage, key: TextKey, values: Record<string, string | number> = {}): string {
  return TEXTS[key][language].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
}
