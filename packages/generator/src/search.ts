/** One page, post or event in the index a visitor's browser searches. */
export type SearchEntry = {
  /** Title. */
  t: string
  /** Address. */
  u: string
  /** page, post (a dated page) or event. */
  k: 'page' | 'post' | 'event'
  /** The words of the page. */
  x: string
  /** The day of a post. */
  d?: string
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”' }

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (all, name: string) => NAMED[name] ?? all)
}

/** The words of a page as plain text: its main part, without the menu, the footer, forms and scripts. */
export function searchText(html: string, limit = 1500): string {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
  const text = decode(
    main
      // The preview marks every text with where it comes from; the marks are not words.
      .replace(/\uE000[\s\S]*?\uE001/g, '')
      .replace(/[\uE000-\uE002]/g, '')
      .replace(/<(script|style|template|svg|nav|header|footer|form|dialog|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= limit) return text
  return text.slice(0, limit).replace(/\s+\S*$/, '')
}

/** How much text each entry may keep, so that a big site's index stays a size a phone loads quickly. */
export function textLimit(count: number): number {
  return count > 800 ? 400 : count > 400 ? 700 : count > 150 ? 1100 : 1500
}

export function searchIndexJson(entries: SearchEntry[]): string {
  const limit = textLimit(entries.length)
  return JSON.stringify(entries.map((entry) => ({ ...entry, x: entry.x.length > limit ? entry.x.slice(0, limit).replace(/\s+\S*$/, '') : entry.x })))
}
