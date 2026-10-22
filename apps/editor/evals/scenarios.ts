import path from 'node:path'
import fs from 'node:fs'
import { listLayoutNames, listPageSlugs, readLayout, readPage, readProposal, setupAccepted, writePage } from '@schlor/generator'
import { buildSetupMessage } from '../lib/setup-questions'
import { contentUntouched, designHoldsNoContent, designUntouched, proposalAccepts, publishable, sentencesKept, type Check, type Scenario } from '../lib/eval'

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
  writePage(root, { slug, layout, title: { de: de.title, en: en.title }, slots: { body: { de: de.body, en: en.body } } })
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
    id: 'reuse-layout',
    title: 'A new page of a known kind reuses or forks a layout and fills its slots',
    turns: ['Lege eine Seite „Seminarraum“ an, ähnlich wie der Veranstaltungsraum: kurzer Text, zwei Fotos und eine E-Mail-Adresse seminar@example.org. Beide Sprachen.'],
    prepare: (root) => {
      writePage(root, {
        slug: 'veranstaltungsraum',
        layout: 'room',
        title: { de: 'Veranstaltungsraum', en: 'Event room' },
        slots: {
          body: { de: ROOM_DE.join('\n\n'), en: ROOM_EN.join('\n\n') },
          images: [{ src: '/media/raum-1.jpg', caption: { de: 'Der Raum', en: 'The room' } }],
          email: 'raum@example.org',
        },
      })
    },
    checks: ({ root, changed }) => {
      const page = readPage(root, 'seminarraum')
      const designDir = path.join(root, 'design')
      const layouts = listLayoutNames(designDir)
      return [
        { name: 'the seminar page exists', ok: page !== null },
        { name: 'it has the email address', ok: JSON.stringify(page?.slots ?? {}).includes('seminar@example.org') },
        { name: 'at most one layout was added', ok: layouts.length <= 9, detail: layouts.join(', ') },
        { name: 'every layout has a purpose', ok: layouts.every((name) => readLayout(designDir, name).purpose.length > 0) },
        { name: 'the other page is untouched', ok: !changed.some((file) => file.includes('pages/veranstaltungsraum')) },
        designHoldsNoContent(root),
        publishable(root),
      ]
    },
  },
  {
    id: 'setup-from-url',
    title: 'Setup from a public site proposes before it writes',
    network: true,
    mode: 'setup',
    turns: ['Richte die Website anhand von https://schlor.org ein. Gleiche Hauptfarben, ähnliche Struktur. Mach einen Vorschlag.'],
    prepare: () => undefined,
    checks: ({ root }) => proposalAccepts(root),
  },
  {
    id: 'setup-with-source-site',
    title: 'Setup takes the texts, pictures and look of a source site for its main pages',
    network: true,
    mode: 'setup',
    turns: [
      buildSetupMessage(
        {
          name: 'SchloR',
          source: 'https://schlor.org',
          take: 'Die Texte, Die Bilder, Das Aussehen',
          scope: 'Die wichtigsten Seiten (bis zu 10)',
          about: 'Ein selbstverwaltetes Haus- und Gewerbeprojekt in Salzburg.',
          languages: 'Nur Deutsch',
          sections: 'Über uns, Räume, Mitmachen, Kontakt',
          calendar: 'Nein',
        },
        'de',
      ),
    ],
    prepare: () => undefined,
    checks: ({ root }) => [
      ...proposalAccepts(root),
      sourceTextsTaken(root),
    ],
  },
  {
    id: 'setup-import-all',
    title: 'Setup imports every page of a source site after the proposal is accepted',
    network: true,
    mode: 'setup',
    turns: [
      buildSetupMessage(
        {
          name: 'SchloR',
          source: 'https://schlor.org',
          take: 'Die Texte, Die Bilder',
          scope: 'Alle Seiten und Beiträge',
          about: 'Ein selbstverwaltetes Haus- und Gewerbeprojekt in Salzburg.',
          languages: 'Nur Deutsch',
          sections: 'Über uns, Aktuelles, Kontakt',
          calendar: 'Nein',
        },
        'de',
      ),
      'Ich nehme den ganzen Vorschlag an. Importiere danach den Rest der Website.',
    ],
    prepare: () => undefined,
    checks: ({ root }) => {
      const slugs = listPageSlugs(root)
      const record = path.join(root, 'content', 'sources.yml')
      return [
        { name: 'setup is accepted', ok: setupAccepted(root) },
        { name: 'the pages were imported', ok: slugs.length > 15, detail: `${slugs.length} pages` },
        { name: 'the import was recorded', ok: fs.existsSync(record) },
        sourceTextsTaken(root),
        publishable(root),
      ]
    },
  },
]

/** The pages (and the recorded proposal) show no picture from another host, and at least one picture was saved into the site. */
function sourceTextsTaken(root: string): Check {
  const external: string[] = []
  const scan = (label: string, value: unknown) => {
    for (const match of JSON.stringify(value ?? {}).matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) external.push(`${label}: ${match[1]}`)
  }
  for (const slug of listPageSlugs(root)) scan(slug, readPage(root, slug)?.slots)
  scan('proposal', readProposal(root).pages)
  const pictures = fs.existsSync(path.join(root, 'media')) ? fs.readdirSync(path.join(root, 'media')).filter((file) => /\.(?:jpe?g|png|webp|gif)$/i.test(file)).length : 0
  return { name: 'pictures are saved in the site, none loaded from another host', ok: external.length === 0 && pictures > 0, detail: external.slice(0, 3).join(' | ') || `${pictures} pictures` }
}

function contains(root: string, slug: string, lang: string, text: string): boolean {
  const body = readPage(root, slug)?.slots.body as Record<string, string> | undefined
  return Boolean(body?.[lang]?.includes(text))
}
