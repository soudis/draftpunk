import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initSite, listLayoutNames, parseTokens, readFonts, readTokens } from '@schlor/generator'
import { addFont, fontId, tokenFontsWithoutFiles } from './fonts-add'
import { designContentRefusal, externalResource } from './layout-guard'
import { systemPrompt } from './prompt'
import { designTools } from './tools'

const call = { toolCallId: 'baseline', messages: [] as never[] }
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(40)])

function newSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-baseline-'))
  initSite(root)
  return root
}

test('a design file that loads from another host is refused, and a link or a data address is not', () => {
  const loads = [
    ['template', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora">'],
    ['template', '<link rel="preconnect" href="https://fonts.gstatic.com">'],
    ['template', '<script src="//cdn.example.com/a.js"></script>'],
    ['template', '<img src="https://images.example.com/a.jpg" alt="">'],
    ['template', '<img srcset="/a.jpg 1x, https://x.example/b.jpg 2x" alt="">'],
    ['template', '<iframe src="https://www.youtube.com/embed/x"></iframe>'],
    ['template', '<video poster="https://x.example/p.jpg"></video>'],
    ['template', '<div style="background: url(https://x.example/a.png)"></div>'],
    ['template', '<style>@import url("https://fonts.googleapis.com/css?family=X");</style>'],
    ['template', '<svg><image href="https://x.example/a.svg"></image></svg>'],
    ['style', '@import "https://fonts.googleapis.com/css2?family=Lora";'],
    ['style', '@font-face { font-family: X; src: url(https://fonts.gstatic.com/x.woff2); }'],
    ['style', '.a { background: url( //cdn.example.com/a.png ); }'],
  ] as const
  for (const [kind, content] of loads) assert.ok(externalResource(content, kind), content)
  const fine = [
    ['template', '<a href="https://www.syndikat.org/">Syndikat</a>'],
    ['template', '<link rel="canonical" href="https://example.org/">'],
    ['template', '<link rel="alternate" hreflang="en" href="{{ item.href }}">'],
    ['template', '<link rel="stylesheet" href="/assets/styles.css">'],
    ['template', '<img src="{{ slots.photo }}" alt="">'],
    ['template', '<svg xmlns="http://www.w3.org/2000/svg"><use href="#icon"></use></svg>'],
    ['template', '{# <script src="https://x.example/a.js"></script> #}<p>{{ slots.body }}</p>'],
    ['style', '.a { background: url(data:image/png;base64,AAAA); } @font-face { src: url("/media/fonts/a.woff2") format("woff2"); } /* url(https://x.example/a.png) */'],
  ] as const
  for (const [kind, content] of fine) assert.equal(externalResource(content, kind), null, content)
  const refusal = designContentRefusal('shell.njk', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora">', [])
  assert.match(refusal ?? '', /^design\/shell\.njk loads https:\/\/fonts\.googleapis\.com\/css2\?family=Lora from another host\. A visitor's browser would contact it/)
  assert.match(refusal ?? '', /save_picture for a picture, add_font for a font\. A plain link to another site is fine\./)
})

test('the starter loads nothing from outside, uses only fonts it has files for, and keeps its baseline', () => {
  const root = newSite()
  const design = path.join(root, 'design')
  const files = ['shell.njk', 'styles.css', ...listLayoutNames(design).flatMap((name) => [`layouts/${name}/template.njk`, `layouts/${name}/style.css`])]
  for (const rel of files) {
    const text = fs.readFileSync(path.join(design, rel), 'utf8')
    assert.equal(externalResource(text, rel.endsWith('.css') ? 'style' : 'template'), null, rel)
  }
  const shell = fs.readFileSync(path.join(design, 'shell.njk'), 'utf8')
  assert.match(shell, /class="skip-link" href="#main"/)
  assert.match(shell, /<main id="main">/)
  assert.match(shell, /for="menu-toggle"/)
  assert.deepEqual(tokenFontsWithoutFiles(root, readTokens(root).fonts), [])
  assert.deepEqual(tokenFontsWithoutFiles(root, { serif: '"Lora", serif', mono: 'ui-monospace, monospace' }), [
    'fonts.serif is Lora, which has no file in fonts.yml, so visitors would see a fallback font. Call add_font with family Lora.',
  ])
  for (const face of readFonts(root)) assert.equal(fs.existsSync(path.join(root, face.file.slice(1))), true, face.file)
})

function catalogFetch(requests: string[], overrides: Record<string, unknown> = {}) {
  const lora = {
    id: 'lora',
    family: 'Lora',
    subsets: ['latin', 'latin-ext'],
    weights: [400, 500, 700],
    styles: ['normal', 'italic'],
    category: 'serif',
    license: 'OFL-1.1',
    unicodeRange: { latin: 'U+0000-00FF', 'latin-ext': 'U+0100-02BA' },
    variants: Object.fromEntries(
      [400, 500, 700].map((weight) => [
        String(weight),
        Object.fromEntries(['normal', 'italic'].map((style) => [style, Object.fromEntries(['latin', 'latin-ext'].map((subset) => [subset, { url: { woff2: `https://cdn.example/lora/${subset}-${weight}-${style}.woff2` } }]))])),
      ]),
    ),
    ...overrides,
  }
  return async (url: string) => {
    requests.push(url)
    if (url === 'https://api.fontsource.org/v1/fonts/lora') return new Response(JSON.stringify(lora), { status: 200 })
    if (url.endsWith('.woff2')) return new Response(WOFF2, { status: 200 })
    return new Response('', { status: 404 })
  }
}

test('add_font puts an open-licence family into the site, registers it, and sets the token', async () => {
  const root = newSite()
  const requests: string[] = []
  const tools = designTools(root, { fetchPage: catalogFetch(requests) })
  const result = String(await tools.add_font.execute!({ family: 'Lora', weights: [400, 700], italic: true, as: 'serif' }, call))
  assert.match(result, /Added Lora \(400, 700, with italic; latin\) as 4 files in media\/fonts\. Licence OFL-1\.1\. Nothing is loaded from another host\./)
  assert.match(result, /Set the font token serif to Lora\. Use font-serif/)
  for (const name of ['lora-latin-400-normal', 'lora-latin-400-italic', 'lora-latin-700-normal', 'lora-latin-700-italic']) {
    assert.equal(fs.readFileSync(path.join(root, 'media', 'fonts', `${name}.woff2`)).subarray(0, 4).toString('latin1'), 'wOF2')
  }
  const faces = readFonts(root).filter((face) => face.family === 'Lora')
  assert.equal(faces.length, 4)
  assert.deepEqual(faces.filter((face) => face.preload).map((face) => face.file), ['/media/fonts/lora-latin-400-normal.woff2'])
  assert.equal(faces[0].unicodeRange, 'U+0000-00FF')
  assert.equal(readFonts(root).filter((face) => face.family === 'Source Sans 3').length, 2)
  assert.equal(readTokens(root).fonts.serif, '"Lora", ui-serif, Georgia, serif')
  assert.match(fs.readFileSync(path.join(root, 'dist', 'assets', 'styles.css'), 'utf8'), /font-family: "Lora";/)
  const before = requests.length
  await tools.add_font.execute!({ family: 'Lora', weights: [400, 700], italic: true }, call)
  assert.equal(requests.length - before, 1)
  assert.equal(readFonts(root).filter((face) => face.family === 'Lora').length, 4)
  assert.equal(fontId(' Source Sans 3 '), 'source-sans-3')
})

test('add_font refuses what it cannot make sure is free and fine, and says what exists', async () => {
  const root = newSite()
  const ask = (fetchPage: (url: string) => Promise<Response>, input: Record<string, unknown>) => designTools(root, { fetchPage }).add_font.execute!(input as never, call)
  await assert.rejects(() => ask(catalogFetch([]), { family: 'Nope Sans' }), /No font named Nope Sans in the open fonts catalog/)
  await assert.rejects(() => ask(catalogFetch([], { license: 'Proprietary' }), { family: 'Lora' }), /licence Proprietary, which is not one of the open licences/)
  await assert.rejects(() => ask(catalogFetch([]), { family: 'Lora', weights: [300] }), /Lora has the weights 400, 500, 700, not 300/)
  await assert.rejects(() => ask(catalogFetch([]), { family: 'Lora', subsets: ['greek'] }), /Lora has the subsets latin, latin-ext, not greek/)
  await assert.rejects(() => ask(catalogFetch([], { styles: ['normal'] }), { family: 'Lora', italic: true }), /Lora has no italic/)
  await assert.rejects(() => ask(catalogFetch([]), { family: 'Lora', as: 'Big Serif' }), /as must be a token name/)
  const notFont = async (url: string) => (url.endsWith('.woff2') ? new Response('<html>', { status: 200 }) : catalogFetch([])(url))
  await assert.rejects(() => ask(notFont, { family: 'Lora', weights: [400] }), /is not a woff2 font/)
  assert.equal(fs.existsSync(path.join(root, 'media', 'fonts', 'lora-latin-400-normal.woff2')), false)
})

test('a font token with no file is reported, a bad fonts.yml is refused, and the prompt tells the baseline', async () => {
  const root = newSite()
  const tools = designTools(root)
  const result = String(await tools.edit_design.execute!({ path: 'tokens.yml', find: '"Source Serif 4", ui-serif, Georgia, serif', replace: '"Lora", serif' }, call))
  assert.match(result, /Token check \(advice\): fonts\.serif is Lora, which has no file in fonts\.yml/)
  await assert.rejects(() => tools.write_design.execute!({ path: 'fonts.yml', content: '- family: Lora\n  file: https://fonts.gstatic.com/l.woff2\n' }, call), /A font from another host is not allowed/)
  await assert.rejects(() => tools.write_design.execute!({ path: 'shell.njk', content: fs.readFileSync(path.join(root, 'design', 'shell.njk'), 'utf8').replace('</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora"></head>') }, call), /loads https:\/\/fonts\.googleapis\.com/)
  const prompt = systemPrompt('edit', root)
  assert.match(prompt, /A site loads nothing from another host/)
  assert.match(prompt, /For another font call add_font/)
  assert.match(prompt, /The deployment supplies it, so never ask for it/)
  assert.match(systemPrompt('setup', root), /call add_font for it, with as set, before you propose tokens/)
  assert.ok(parseTokens(fs.readFileSync(path.join(root, 'design', 'tokens.yml'), 'utf8')).fonts.serif.startsWith('"Lora"'))
})
