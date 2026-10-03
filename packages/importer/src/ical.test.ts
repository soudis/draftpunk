import assert from 'node:assert/strict'
import test from 'node:test'
import { parseIcal, splitLanguages } from './ical'

const sample = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:239@schlor.org
DTSTART;TZID=Europe/Vienna:20261022T190000
DTEND;TZID=Europe/Vienna:20261022T220000
URL:https://schlor.org/events/ping-pong-beisl-at-schlor/
SUMMARY:Ping Pong Beisl at SchloR
DESCRIPTION:Herbst bei SchloR\\n\\nAutumn at SchloR
CATEGORIES:Café/Beisl,Mitmachen
LOCATION:Rappachgasse 26\\, 1110 Wien
END:VEVENT
END:VCALENDAR`

test('ical keeps the series fields and Vienna time', () => {
  const [event] = parseIcal(sample)
  assert.equal(event.summary, 'Ping Pong Beisl at SchloR')
  assert.equal(event.location.includes('Rappachgasse'), true)
  assert.deepEqual(event.categories, ['Café/Beisl', 'Mitmachen'])
  assert.equal(event.start, '2026-10-22T17:00:00.000Z')
  const text = splitLanguages('Herbst bei SchloR\n\nAutumn at SchloR')
  assert.equal(text.de, 'Herbst bei SchloR')
  assert.equal(text.en, 'Autumn at SchloR')
})
