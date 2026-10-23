import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { initSite } from '@schlor/generator'
import { attachScreenshots } from './agent'
import { listPictures, storePicture } from './pictures'
import { pictureTools } from './picture-tools'
import { ScreenshotStore } from './screenshots'

const call = { toolCallId: 'picture', messages: [] }

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>
  <g id="left" transform="translate(10 5)"><rect id="box" x="0" y="0" width="20" height="20" fill="red"/></g>
  <circle id="dot" cx="80" cy="25" r="10" fill="url(#g)"/>
</svg>`

async function site() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-picture-tools-'))
  initSite(root)
  const png = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } })
    .composite([{ input: await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer(), left: 200, top: 50 }])
    .png()
    .toBuffer()
  storePicture(root, { bytes: png, filename: 'hof.png', description: 'Der Hof' })
  storePicture(root, { bytes: new TextEncoder().encode(SVG), filename: 'zeichen.svg' })
  return root
}

const text = (value: unknown) => String(value)

test('the model is shown a picture with a grid, once, and a model that cannot look is told so', async () => {
  const root = await site()
  const store = new ScreenshotStore()
  const tools = pictureTools(root, { vision: true, screenshots: store })
  const answer = text(await tools.look_at_picture.execute!({ file: '/media/hof.png' }, call))
  assert.match(answer, /^\/media\/hof\.png: PNG, 400 × 200 px, no see-through parts\. Grid lines every 10 %/)
  const id = /\[screenshot:(s\d+)\]/.exec(answer)?.[1]
  assert.ok(id && store.get(id), 'the picture is kept for the next step')
  const messages = attachScreenshots([{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'look_at_picture', output: { type: 'text', value: answer } }] }] as never, store)
  assert.equal(messages.length, 2)
  assert.match(JSON.stringify(messages[1]), /The picture from look_at_picture:/)
  const blind = text(await pictureTools(root, { vision: false }).look_at_picture.execute!({ file: 'hof.png', grid: false }, call))
  assert.doesNotMatch(blind, /\[screenshot:/)
  assert.match(blind, /cannot look at pictures/)
  await assert.rejects(() => tools.look_at_picture.execute!({ file: 'nothing.png' }, call), /Unknown picture/)
})

test('edit_picture writes a new picture, notes where it came from, and says which step failed', async () => {
  const root = await site()
  const tools = pictureTools(root, { vision: true, screenshots: new ScreenshotStore() })
  const answer = text(await tools.edit_picture.execute!({ file: '/media/hof.png', steps: [{ op: 'crop', x: 50, y: 25, width: 25, height: 50 }, { op: 'make_transparent', color: '#ff0000' }], name: 'quadrat', description: 'Ein Quadrat' }, call))
  assert.match(answer, /^Saved \/media\/quadrat\.png, made from \/media\/hof\.png by crop, make_transparent\. 100 × 100 px, with see-through parts\./)
  const files = listPictures(root).map((picture) => picture.file)
  assert.deepEqual(files.sort(), ['hof.png', 'quadrat.png', 'zeichen.svg'])
  assert.match(fs.readFileSync(path.join(root, 'media', 'pictures.yml'), 'utf8'), /file: quadrat\.png[\s\S]*madeFrom: hof\.png/)
  assert.equal((await sharp(path.join(root, 'media', 'hof.png')).metadata()).width, 400, 'the original is as it was')
  const again = text(await tools.edit_picture.execute!({ file: 'hof.png', steps: [{ op: 'resize', width: 50 }], name: 'quadrat' }, call))
  assert.match(again, /Saved \/media\/quadrat-2\.png/)
  await assert.rejects(() => tools.edit_picture.execute!({ file: 'hof.png', steps: [{ op: 'trim' }, { op: 'crop', x: 5 }] }, call), /Operation 2 \(crop\): crop needs y, width, height\./)
  await assert.rejects(() => tools.edit_picture.execute!({ file: 'hof.png', steps: [] }, call), /steps/)
  const fromSvg = text(await tools.edit_picture.execute!({ file: 'zeichen.svg', steps: [{ op: 'resize', width: 200 }] }, call))
  assert.match(fromSvg, /Saved \/media\/zeichen-edit\.png/)
})

test('an SVG is listed, a part is extracted with a view box that fits it, and colours are changed', async () => {
  const root = await site()
  const tools = pictureTools(root, { vision: true, screenshots: new ScreenshotStore() })
  const outline = text(await tools.svg_outline.execute!({ file: 'zeichen.svg' }, call))
  assert.match(outline, /@\d+ g #left transform=translate\(10 5\)/)
  assert.match(outline, /@\d+ circle #dot/)
  const extracted = text(await tools.svg_extract.execute!({ file: 'zeichen.svg', select: ['#box'], name: 'kasten', margin: 0 }, call))
  assert.match(extracted, /^Saved \/media\/kasten\.svg, \d+ elements kept from \/media\/zeichen\.svg\./)
  const part = fs.readFileSync(path.join(root, 'media', 'kasten.svg'), 'utf8')
  const box = /viewBox="([\d. -]+)"/.exec(part)?.[1].split(' ').map(Number) as number[]
  for (const [actual, expected] of [[box[0], 10], [box[1], 5], [box[2], 20], [box[3], 20]]) assert.ok(Math.abs(actual - expected) < 0.2, `${actual} is not ${expected}`)
  assert.equal(part.includes('id="dot"'), false)
  const gradient = fs.readFileSync(path.join(root, 'media', (text(await tools.svg_extract.execute!({ file: 'zeichen.svg', select: ['#dot'], name: 'punkt' }, call)), 'punkt.svg')), 'utf8')
  assert.ok(gradient.includes('id="g"'), 'the gradient it uses comes along')
  const recolored = text(await tools.svg_edit.execute!({ file: 'zeichen.svg', steps: [{ op: 'recolor', from: 'red', to: '#1f5f54' }, { op: 'remove', select: ['#dot'] }], name: 'gruen' }, call))
  assert.match(recolored, /recolor: 2 colours changed to #1f5f54\.\nremove: 1 element removed\./)
  assert.ok(fs.readFileSync(path.join(root, 'media', 'gruen.svg'), 'utf8').includes('fill="#1f5f54"'))
  await assert.rejects(() => tools.svg_extract.execute!({ file: 'zeichen.svg', select: ['#nothing'] }, call), /Nothing in the SVG matches #nothing/)
  await assert.rejects(() => tools.svg_outline.execute!({ file: 'hof.png' }, call), /is not an SVG/)
  await assert.rejects(() => tools.svg_edit.execute!({ file: 'zeichen.svg', steps: [{ op: 'set', attr: 'onclick', value: 'x' }] }, call), /set can change/)
})

test('an SVG the model writes is cleaned, checked and shown, and a refusal says what to fix', async () => {
  const root = await site()
  const tools = pictureTools(root, { vision: true, screenshots: new ScreenshotStore() })
  const good = text(await tools.write_svg.execute!({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="4" fill="#335"/></svg>', name: 'punkt-blau', description: 'Ein blauer Punkt' }, call))
  assert.match(good, /^Saved \/media\/punkt-blau\.svg\. 2048 × 2048 px/)
  assert.match(good, /Some parts the site does not allow were removed\./)
  assert.equal(fs.readFileSync(path.join(root, 'media', 'punkt-blau.svg'), 'utf8').includes('script'), false)
  const withText = text(await tools.write_svg.execute!({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><text x="2" y="15" font-size="12">Hallo</text></svg>', name: 'wort' }, call))
  assert.match(withText, /It has text: a picture draws it in a system font/)
  await assert.rejects(() => tools.write_svg.execute!({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5"/></svg>', name: 'ohne' }, call), /Give the SVG a viewBox/)
  await assert.rejects(() => tools.write_svg.execute!({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="50" y="50" width="5" height="5"/></svg>', name: 'leer' }, call), /draws nothing/)
  await assert.rejects(() => tools.write_svg.execute!({ svg: '<svg viewBox="0 0 1 1"><rect></svg>', name: 'kaputt' }, call), /That SVG cannot be kept/)
  await assert.rejects(() => tools.write_svg.execute!({ svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${'<path d="M0 0L1 1"/>'.repeat(12_000)}</svg>`, name: 'riesig' }, call), /Keep it under 200 KB/)
})

test('generate_image exists only with an image service, marks what it makes, and stops at four a reply', async () => {
  const root = await site()
  const store = new ScreenshotStore()
  assert.equal(Object.keys(pictureTools(root, { image: { provider: '', baseURL: '', model: '', apiKey: '', configured: false } })).includes('generate_image'), false)
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#2060c0' } }).png().toBuffer()
  const asked: unknown[] = []
  const fetchApi = (async (_url: string, init: RequestInit) => {
    asked.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 })
  }) as unknown as typeof fetch
  const tools = pictureTools(root, {
    vision: true,
    screenshots: store,
    image: { provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: 'sk-test', configured: true },
    imageDeps: { fetchApi },
  })
  assert.ok(tools.generate_image)
  const answer = text(await tools.generate_image.execute!({ prompt: 'A courtyard at dusk, warm light', aspect: 'landscape', name: 'hof-abend', description: 'Der Hof am Abend' }, call))
  assert.match(answer, /^Saved \/media\/hof-abend\.png, made by gpt-image-1 \(1536x1024\)\. It is a generated picture: tell the person so\. 64 × 64 px/)
  assert.match(answer, /\[screenshot:s\d+\]/)
  assert.deepEqual(asked[0], { model: 'gpt-image-1', prompt: 'A courtyard at dusk, warm light', n: 1, size: '1536x1024' })
  const catalog = fs.readFileSync(path.join(root, 'media', 'pictures.yml'), 'utf8')
  assert.match(catalog, /file: hof-abend\.png/)
  assert.match(catalog, /generated:\n\s+prompt: A courtyard at dusk, warm light\n\s+service: openai gpt-image-1/)
  assert.match(catalog, /description: Der Hof am Abend/)
  for (const at of [2, 3, 4]) await tools.generate_image.execute!({ prompt: 'x', aspect: 'square', name: `bild-${at}` }, call)
  await assert.rejects(() => tools.generate_image.execute!({ prompt: 'x', aspect: 'square', name: 'bild-5' }, call), /4 pictures were made in this reply already/)
  assert.equal(asked.length, 4)
  const refused = pictureTools(root, {
    image: { provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: 'k', configured: true },
    imageDeps: { fetchApi: (async () => new Response(JSON.stringify({ error: { message: 'Billing hard limit reached' } }), { status: 400 })) as unknown as typeof fetch },
  })
  await assert.rejects(() => refused.generate_image.execute!({ prompt: 'x', aspect: 'square', name: 'nein' }, call), /Billing hard limit reached/)
  const notAPicture = pictureTools(root, {
    image: { provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: 'k', configured: true },
    imageDeps: { fetchApi: (async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('hello').toString('base64') }] }), { status: 200 })) as unknown as typeof fetch },
  })
  await assert.rejects(() => notAPicture.generate_image.execute!({ prompt: 'x', aspect: 'square', name: 'text' }, call), /did not give a picture/)
})
