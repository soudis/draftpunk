import type { EditorLanguage } from './ui-text'

export type Question = {
  id: 'name' | 'source' | 'take' | 'scope' | 'about' | 'languages' | 'look' | 'sections' | 'calendar' | 'contact'
  title: string
  help?: string
  kind: 'line' | 'text' | 'one' | 'many'
  required: boolean
  placeholder?: string
  /** Only the quick replies count: no field for the person's own words. */
  closed?: boolean
  /** Quick replies. The person may also write their own words. */
  options?: string[]
}

const TAKE = {
  de: ['Das Aussehen', 'Die Texte', 'Die Bilder'],
  en: ['The look', 'The texts', 'The pictures'],
} as const
const SCOPE = {
  de: ['Die wichtigsten Seiten (bis zu 10)', 'Alle Seiten und Beiträge'],
  en: ['The main pages (up to 10)', 'Every page and post'],
} as const

export type Answers = Partial<Record<Question['id'], string>>

/** The questions a fresh site starts with, whichever of them the answers so far make useful. Only two have to be answered. */
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
      id: 'source',
      kind: 'line',
      required: false,
      title: de ? 'Gibt es schon eine Website von euch?' : 'Is there already a website of yours?',
      help: de
        ? 'Fügt den Link ein, wenn ihr daraus etwas übernehmen wollt. Nur Websites, deren Texte und Bilder ihr verwenden dürft.'
        : 'Paste its link if you want to take something from it. Only websites whose texts and pictures you may use.',
      placeholder: 'https://',
    },
    {
      id: 'take',
      kind: 'many',
      required: false,
      closed: true,
      title: de ? 'Was soll ich davon übernehmen?' : 'What should I take from it?',
      options: de ? [...TAKE.de] : [...TAKE.en],
    },
    {
      id: 'scope',
      kind: 'one',
      required: false,
      closed: true,
      title: de ? 'Wie viel davon?' : 'How much of it?',
      options: de ? [...SCOPE.de] : [...SCOPE.en],
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
      closed: true,
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
  de: { name: 'Projektname', source: 'Bisherige Website', take: 'Davon übernehmen', scope: 'Umfang', about: 'Das Projekt', languages: 'Sprachen', look: 'Vorbild oder Stimmung', sections: 'Bereiche', calendar: 'Kalender', contact: 'Kontakt und Impressum' },
  en: { name: 'Project name', source: 'Existing website', take: 'Take from it', scope: 'How much', about: 'The project', languages: 'Languages', look: 'Model site or mood', sections: 'Sections', calendar: 'Calendar', contact: 'Contact and imprint' },
}

function taking(answers: Answers, language: EditorLanguage): { look: boolean; texts: boolean; pictures: boolean } {
  const labels = TAKE[language]
  const picked = (answers.take ?? '').split(', ')
  return { look: picked.includes(labels[0]), texts: picked.includes(labels[1]), pictures: picked.includes(labels[2]) }
}

/**
 * The questions to ask now. What to take and how much only make sense with a link, how much only for texts or
 * pictures, and the question about a model site is not needed when the look comes from the source site.
 */
export function visibleQuestions(language: EditorLanguage, answers: Answers): Question[] {
  const hasSource = (answers.source ?? '').trim() !== ''
  const take = taking(answers, language)
  return setupQuestions(language).filter((question) => {
    if (question.id === 'take') return hasSource
    if (question.id === 'scope') return hasSource && (take.texts || take.pictures)
    if (question.id === 'look') return !(hasSource && take.look)
    return true
  })
}

/** The first message of the setup: what the person answered, in their language. A question left out is not mentioned. */
export function buildSetupMessage(answers: Answers, language: EditorLanguage): string {
  const lines = visibleQuestions(language, answers)
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
