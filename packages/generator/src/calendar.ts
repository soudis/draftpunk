import { localeFor } from './model'

export type CalendarEvent = {
  slug: string
  title: string
  href: string
  start: Date
  end?: Date
}

export type CalendarDay = {
  iso: string
  label: number
  inMonth: boolean
  events: { slug: string; title: string; href: string }[]
}

export type CalendarMonth = {
  label: string
  weeks: CalendarDay[][]
}

export function weekdayLabels(lang: string): string[] {
  const monday = new Date(Date.UTC(2024, 0, 1))
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(localeFor(lang), { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(monday.getTime() + index * 24 * 60 * 60 * 1000),
    ),
  )
}

function zoneParts(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { y: pick('year'), m: pick('month'), d: pick('day') }
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const index = y * 12 + (m - 1) + delta
  return { y: Math.floor(index / 12), m: (index % 12) + 1 }
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function mondayIndex(y: number, m: number, d: number): number {
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return (js + 6) % 7
}

export function buildMonths(
  events: CalendarEvent[],
  lang: string,
  from = new Date(),
  count = 5,
  timeZone = 'Europe/Vienna',
): CalendarMonth[] {
  const start = zoneParts(from, timeZone)
  const byDay = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const parts = zoneParts(event.start, timeZone)
    const key = isoDate(parts.y, parts.m, parts.d)
    const list = byDay.get(key) ?? []
    list.push(event)
    byDay.set(key, list)
  }
  const months: CalendarMonth[] = []
  for (let i = 0; i < count; i++) {
    const { y, m } = addMonths(start.y, start.m, i)
    const label = new Intl.DateTimeFormat(localeFor(lang), {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, 1)))
    const total = daysInMonth(y, m)
    const lead = mondayIndex(y, m, 1)
    const cells: CalendarDay[] = []
    for (let pad = 0; pad < lead; pad++) {
      cells.push({ iso: '', label: 0, inMonth: false, events: [] })
    }
    for (let day = 1; day <= total; day++) {
      const iso = isoDate(y, m, day)
      const eventsOnDay = (byDay.get(iso) ?? []).map((event) => ({
        slug: event.slug,
        title: event.title,
        href: event.href,
      }))
      cells.push({ iso, label: day, inMonth: true, events: eventsOnDay })
    }
    while (cells.length % 7 !== 0) cells.push({ iso: '', label: 0, inMonth: false, events: [] })
    const weeks: CalendarDay[][] = []
    for (let c = 0; c < cells.length; c += 7) weeks.push(cells.slice(c, c + 7))
    months.push({ label, weeks })
  }
  return months
}

export function toIcal(
  events: { uid: string; title: string; start: Date; end?: Date; description?: string; place?: string }[],
  prodid = '-//site//website//EN',
): string {
  const stamp = icalDate(new Date())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodid}`, 'CALSCALE:GREGORIAN']
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icalDate(event.start)}`,
      `DTEND:${icalDate(event.end ?? new Date(event.start.getTime() + 60 * 60 * 1000))}`,
      `SUMMARY:${escapeIcal(event.title)}`,
    )
    if (event.place) lines.push(`LOCATION:${escapeIcal(event.place)}`)
    if (event.description) lines.push(`DESCRIPTION:${escapeIcal(event.description)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

function icalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function escapeIcal(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;')
}
