export type IcalEvent = {
  uid: string
  summary: string
  description: string
  location: string
  categories: string[]
  url?: string
  start: string
  end?: string
}

export function parseIcal(source: string): IcalEvent[] {
  const unfolded = source.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')
  return unfolded
    .split('BEGIN:VEVENT')
    .slice(1)
    .map((block) => {
      const start = value(block, 'DTSTART')
      return {
        uid: value(block, 'UID'),
        summary: decodeIcal(value(block, 'SUMMARY')),
        description: decodeIcal(value(block, 'DESCRIPTION')),
        location: decodeIcal(value(block, 'LOCATION')).replace(/,\s*,/g, ',').trim(),
        categories: decodeIcal(value(block, 'CATEGORIES'))
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        url: value(block, 'URL') || undefined,
        start: toIsoStamp(start),
        end: value(block, 'DTEND') ? toIsoStamp(value(block, 'DTEND')) : undefined,
      }
    })
    .filter((event) => event.summary && event.start)
}

export function splitLanguages(description: string): { de: string; en: string } {
  const match = description.split(/\n\n(?=Autumn|Winter|Spring|Summer|Just |The |A |An |Music )/)
  if (match.length > 1) return { de: match[0].trim(), en: match.slice(1).join('\n\n').trim() }
  return { de: description.trim(), en: '' }
}

function value(block: string, name: string): string {
  const match = block.match(new RegExp(`^${name}(?:;[^:\\n]*)?:([^\\n]*)`, 'm'))
  return match?.[1]?.trim() ?? ''
}

function decodeIcal(value: string): string {
  return value
    .replaceAll('\\n', '\n')
    .replaceAll('\\,', ',')
    .replaceAll('\\;', ';')
    .replaceAll('\\\\', '\\')
    .replaceAll('&amp;', '&')
    .replaceAll('&nbsp;', ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
}

export function toIsoStamp(stamp: string): string {
  const dateOnly = stamp.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) return toIsoStamp(`${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}T000000`)
  const match = stamp.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
  if (!match) return stamp
  const [, y, m, d, hh, mm, ss] = match
  const desired = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
  let guess = desired
  for (let i = 0; i < 4; i++) {
    const wall = wallTime(new Date(guess))
    const wallAsUtc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.hh, wall.mm, wall.ss)
    guess += desired - wallAsUtc
  }
  return new Date(guess).toISOString()
}

function wallTime(date: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { y: pick('year'), m: pick('month'), d: pick('day'), hh: pick('hour'), mm: pick('minute'), ss: pick('second') }
}
