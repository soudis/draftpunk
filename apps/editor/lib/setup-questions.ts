import type { EditorLanguage } from './ui-text'

export type Question = {
  id: 'name' | 'about' | 'languages' | 'look' | 'sections' | 'calendar' | 'contact'
  title: string
  help?: string
  kind: 'line' | 'text' | 'one' | 'many'
  required: boolean
  placeholder?: string
  /** Quick replies. The person may also write their own words. */
  options?: string[]
}

export type Answers = Partial<Record<Question['id'], string>>

/** The questions a fresh site starts with. Only the first two have to be answered. */
export function setupQuestions(language: EditorLanguage): Question[] {
  const de = language === 'de'
  return [
    {
      id: 'name',
      kind: 'line',
      required: true,
      title: de ? 'Wie heißt euer Projekt?' : 'What is your project called?',
      placeholder: de ? 'zum Beispiel SchloR' : 'for example SchloR',
    },
    {
      id: 'about',
      kind: 'text',
      required: true,
      title: de ? 'Was ist es?' : 'What is it?',
      help: de
        ? 'Zwei, drei Sätze: wer ihr seid, was ihr tut und was Besucher wissen sollen. Namen und Fakten nehme ich so, wie ihr sie schreibt.'
        : 'Two or three sentences: who you are, what you do, and what visitors should know. I take names and facts as you write them.',
    },
    {
      id: 'languages',
      kind: 'one',
      required: false,
      title: de ? 'Welche Sprachen soll die Website haben?' : 'Which languages should the website have?',
      options: de
        ? ['Nur Deutsch', 'Deutsch und Englisch (Englisch darf fehlen)', 'Deutsch und Englisch (beides Pflicht)']
        : ['German only', 'German and English (English may be missing)', 'German and English (both required)'],
    },
    {
      id: 'look',
      kind: 'one',
      required: false,
      title: de ? 'Gibt es eine Website, deren Aussehen euch gefällt?' : 'Is there a website whose look you like?',
      help: de ? 'Fügt einen Link ein, oder beschreibt die Stimmung.' : 'Paste a link, or describe the mood.',
      placeholder: 'https://',
      options: de ? ['ruhig und schlicht', 'warm und farbig', 'kräftig und modern'] : ['calm and plain', 'warm and colorful', 'bold and modern'],
    },
    {
      id: 'sections',
      kind: 'many',
      required: false,
      title: de ? 'Welche Bereiche erwartet ihr?' : 'Which sections do you expect?',
      options: de
        ? ['Über uns', 'Räume', 'Mitmachen', 'Aktuelles', 'Kontakt', 'Unterstützen']
        : ['About us', 'Rooms', 'Join in', 'News', 'Contact', 'Support us'],
    },
    {
      id: 'calendar',
      kind: 'one',
      required: false,
      title: de ? 'Braucht ihr einen Veranstaltungskalender?' : 'Do you need an events calendar?',
      options: de ? ['Ja', 'Nein'] : ['Yes', 'No'],
    },
    {
      id: 'contact',
      kind: 'text',
      required: false,
      title: de ? 'Kontakt und Impressum' : 'Contact and imprint',
      help: de
        ? 'E-Mail-Adresse, Anschrift und wer verantwortlich ist, falls schon bekannt. Was fehlt, bleibt als Platzhalter stehen.'
        : 'Email address, postal address, and who is responsible, if known. What is missing stays a placeholder.',
    },
  ]
}

const LABELS: Record<EditorLanguage, Record<Question['id'], string>> = {
  de: { name: 'Projektname', about: 'Das Projekt', languages: 'Sprachen', look: 'Vorbild oder Stimmung', sections: 'Bereiche', calendar: 'Kalender', contact: 'Kontakt und Impressum' },
  en: { name: 'Project name', about: 'The project', languages: 'Languages', look: 'Model site or mood', sections: 'Sections', calendar: 'Calendar', contact: 'Contact and imprint' },
}

/** The first message of the setup: what the person answered, in their language. A question left out is not mentioned. */
export function buildSetupMessage(answers: Answers, language: EditorLanguage): string {
  const lines = setupQuestions(language)
    .map((question) => [question, (answers[question.id] ?? '').trim()] as const)
    .filter(([, answer]) => answer !== '')
    .map(([question, answer]) => `- ${LABELS[language][question.id]}: ${answer.replace(/\s*\n\s*/g, ' ')}`)
  const intro = language === 'de' ? 'Richte die Website ein. Das sind meine Antworten:' : 'Set up the website. These are my answers:'
  return [intro, ...lines].join('\n')
}

/** Whether the questions up to this one are answered well enough to go on. */
export function canGoOn(question: Question, answer: string | undefined): boolean {
  return !question.required || (answer ?? '').trim().length > 0
}
