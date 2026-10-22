import fs from 'node:fs'
import { contentPagePath, writePageFile } from '@schlor/generator'
import { contentUntouched, designHoldsNoContent, designUntouched, publishable, sentencesKept, type Scenario } from '../lib/eval'

const ROOM_DE = [
  'Der Veranstaltungsraum ist ca. 68 m² groß und eignet sich für unterschiedliche Formate.',
  'Der Raum liegt im Erdgeschoss, hat Tageslicht und gibt Platz zum Draußensitzen.',
  'Vor Ort gibt es fast alles, was man für eine Veranstaltung braucht.',
  'Der Raum ist barrierearm zugänglich, das WC ebenfalls.',
]
const ROOM_EN = [
  'The event room is about 68 m² and suits many formats.',
  'The room is on the ground floor, has daylight, and room to sit outside.',
  'On site there is almost everything an event needs.',
  'The room is largely step-free, and so is the toilet.',
]

function twoLanguagePage(root: string, slug: string, layout: string, de: { title: string; body: string }, en: { title: string; body: string }) {
  writePageFile(contentPagePath(root, slug, 'de'), { layout, title: de.title, body: de.body, data: {} })
  writePageFile(contentPagePath(root, slug, 'en'), { layout, title: en.title, body: en.body, data: {} })
}

function prepareRoom(root: string) {
  twoLanguagePage(
    root,
    'veranstaltungsraum',
    'article',
    { title: 'Veranstaltungsraum', body: ROOM_DE.join('\n\n') },
    { title: 'Event room', body: ROOM_EN.join('\n\n') },
  )
  twoLanguagePage(root, 'werkstatt', 'article', { title: 'Werkstatt', body: 'Holz, Metall und Fahrräder.' }, { title: 'Workshop', body: 'Wood, metal, and bikes.' })
}

export const scenarios: Scenario[] = [
  {
    id: 'content-only',
    title: 'A content change leaves the design alone',
    turns: ['Die Telefonnummer auf der Kontaktseite ist jetzt 0660 123 4567.'],
    prepare: (root) => {
      twoLanguagePage(
        root,
        'kontakt',
        'article',
        { title: 'Kontakt', body: 'Ruf uns an: 0660 000 0000.\n\nOder schreib an hallo@example.org.' },
        { title: 'Contact', body: 'Call us: 0660 000 0000.\n\nOr write to hallo@example.org.' },
      )
    },
    checks: ({ root, changed }) => [
      designUntouched(changed),
      { name: 'the new number is on the German page', ok: contains(root, 'kontakt', 'de', '0660 123 4567') },
      { name: 'the old number is gone', ok: !contains(root, 'kontakt', 'de', '0660 000 0000') },
      { name: 'the email line is unchanged', ok: contains(root, 'kontakt', 'de', 'hallo@example.org') },
      publishable(root),
    ],
  },
  {
    id: 'layout-only',
    title: 'A look change keeps every sentence and puts no words in the design',
    turns: ['Gestalte die Veranstaltungsraum-Seite schöner: ein Titelband und die Informationen als übersichtliche Abschnitte. Die Texte sollen bleiben.'],
    prepare: prepareRoom,
    checks: ({ root, changed }) => [
      sentencesKept(root, 'veranstaltungsraum', ROOM_DE),
      sentencesKept(root, 'en/veranstaltungsraum', ROOM_EN),
      designHoldsNoContent(root),
      { name: 'the other page is untouched', ok: !changed.some((file) => file.includes('pages/werkstatt/')) },
      { name: 'the design changed', ok: changed.some((file) => file.startsWith('design/')) },
      publishable(root),
    ],
  },
  {
    id: 'refine',
    title: 'Two follow-up look requests build on each other',
    turns: ['Mach die Kopfzeile dunkelblau mit weißer Schrift.', 'Die Akzentfarbe der Links darf etwas wärmer sein.'],
    prepare: prepareRoom,
    checks: ({ root, changed }) => [
      contentUntouched(changed),
      designHoldsNoContent(root),
      { name: 'the stylesheet or shell changed', ok: changed.some((file) => file === 'design/styles.css' || file === 'design/shell.njk') },
      publishable(root),
    ],
  },
  {
    id: 'setup-from-url',
    title: 'Setup from a public site proposes before it writes',
    network: true,
    mode: 'setup',
    turns: ['Richte die Website anhand von https://schlor.org ein. Gleiche Hauptfarben, ähnliche Struktur. Mach einen Vorschlag.'],
    prepare: () => undefined,
    checks: ({ root }) => [designHoldsNoContent(root), publishable(root)],
  },
]

function contains(root: string, slug: string, lang: string, text: string): boolean {
  const file = contentPagePath(root, slug, lang)
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(text)
}
