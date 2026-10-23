import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { initSite, writePage } from '@schlor/generator'
import { picturesWithoutWords, setPictureAlt } from './pictures'
import { contentTools } from './tools'

const call = { toolCallId: 'check', messages: [] }

test('the whole site is checked, and a picture gets its words from the person or as decoration', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-site-check-'))
  initSite(root)
  fs.mkdirSync(path.join(root, 'media'), { recursive: true })
  for (const name of ['hof.png', 'muster.png']) {
    fs.writeFileSync(path.join(root, 'media', name), await sharp({ create: { width: 32, height: 32, channels: 3, background: '#335' } }).png().toBuffer())
  }
  const body = 'Das ist eine ausreichend lange Seite über den Hof und das Muster daneben. ![](/media/hof.png) ![](/media/muster.png) [Weg](/gibts-nicht/)'
  writePage(root, { slug: 'hof', layout: 'article', title: { de: 'Hof', en: 'Yard' }, slots: { body: { de: body, en: body } } })
  const tools = contentTools(root)

  const report = (await tools.check_site.execute!({}, call)) as string
  assert.match(report, /\/gibts-nicht\/ — on \/en\/hof\/, \/hof\//)
  assert.match(report, /\/media\/hof\.png — on 2 pages/)
  assert.match(report, /\/media\/muster\.png — on 2 pages/)
  assert.deepEqual(picturesWithoutWords(root).map((picture) => picture.file).sort(), ['hof.png', 'muster.png'])

  // A text per language, and a decoration, both leave the list; neither needs a description.
  assert.match((await tools.set_picture_alt.execute!({ file: '/media/hof.png', alt: { de: 'Der Hof im Herbst', en: 'The yard in autumn' } }, call)) as string, /alt text/)
  await tools.set_picture_alt.execute!({ file: 'muster.png', decorative: true }, call)
  assert.deepEqual(picturesWithoutWords(root), [])
  const page = fs.readFileSync(path.join(root, 'dist', 'hof', 'index.html'), 'utf8')
  assert.match(page, /alt="Der Hof im Herbst"/)
  assert.match(fs.readFileSync(path.join(root, 'dist', 'en', 'hof', 'index.html'), 'utf8'), /alt="The yard in autumn"/)
  assert.match(page, /<img[^>]*muster\.png[^>]*alt=""|<img[^>]*alt=""[^>]*muster\.png/)
  const again = (await tools.check_site.execute!({}, call)) as string
  assert.doesNotMatch(again, /Pictures that say nothing/)
  // The text a person gave survives a rename of the picture's description.
  assert.deepEqual(setPictureAlt(root, 'hof.png', { alt: { fr: "La cour" } }).file, 'hof.png')
  assert.match(fs.readFileSync(path.join(root, 'media', 'pictures.yml'), 'utf8'), /de: Der Hof im Herbst/)
  assert.match(await tools.describe_pictures.execute!({}, call) as string, /Every picture a page shows has words already/)
})
