import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { closeBrowser } from './browser'
import { firstParagraph, splitTitle, unescapeMarkdown } from './import-pages'
import { TEXT_SOURCE, type RawText } from './site-text'
import { withSitePage } from './web-render'

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file))

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Seite</title></head><body><main>
<h1>Für Nutzer*innen</h1>
<p>Liebe Mieter*innen, das ist <em>wichtig</em> und <strong>sehr</strong> dringend; die Datei heißt snake_case_name.txt, ein Pfad C:\\Temp.</p>
<ul><li>Gärtner*innen und Köch_innen</li></ul>
</main></body></html>`

test('a star, an underscore and a backslash in the words of a page are escaped, and real emphasis is kept', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  try {
    const fetchPage = async () => new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } })
    const raw = await withSitePage('https://x.example/', { fetchPage }, async (page) => (await page.evaluate(TEXT_SOURCE)) as RawText)
    assert.match(raw.markdown, /^# Für Nutzer\\\*innen$/m)
    assert.match(raw.markdown, /Liebe Mieter\\\*innen, das ist \*wichtig\* und \*\*sehr\*\* dringend; die Datei heißt snake\\_case\\_name\.txt, ein Pfad C:\\\\Temp\./)
    assert.match(raw.markdown, /- Gärtner\\\*innen und Köch\\_innen/)
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})

test('a title and a first paragraph read as plain text keep a gender star and an underscore', () => {
  assert.equal(unescapeMarkdown('Nutzer\\*innen und snake\\_case und C:\\\\Temp'), 'Nutzer*innen und snake_case und C:\\Temp')
  const split = splitTitle({ title: 'Seite', markdown: '# Für Nutzer\\*innen\n\nText.', date: '' })
  assert.equal(split.title, 'Für Nutzer*innen')
  assert.equal(firstParagraph('Liebe Mieter\\*innen, das ist *wichtig* und **sehr** dringend, wie snake\\_case.\n\nZweiter Absatz.'), 'Liebe Mieter*innen, das ist wichtig und sehr dringend, wie snake_case.')
})
