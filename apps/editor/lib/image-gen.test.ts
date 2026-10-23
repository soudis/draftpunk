import assert from 'node:assert/strict'
import test from 'node:test'
import { generateImage, pixels, serviceError, type ImageDeps } from './image-gen'
import type { ResolvedImageSettings } from './image-settings'

const publicResolve = async () => [{ address: '93.184.216.34' }]
const PNG = Uint8Array.from([137, 80, 78, 71, 1, 2, 3])
const b64 = Buffer.from(PNG).toString('base64')

type Seen = { url: string; init: RequestInit; body?: unknown }

/** A service that answers in turn with the given replies, and notes what it was asked. */
function service(replies: (Response | (() => Response))[]): { deps: ImageDeps; seen: Seen[] } {
  const seen: Seen[] = []
  const queue = [...replies]
  const fetchApi = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {}, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const next = queue.shift()
    if (!next) throw new Error('unexpected call')
    return typeof next === 'function' ? next() : next
  }) as typeof fetch
  const fetchPage = async () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
  return { deps: { fetchApi, fetchPage, resolve: publicResolve, pollMs: 1, waitMs: 2000 }, seen }
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const settings = (patch: Partial<ResolvedImageSettings>): ResolvedImageSettings => ({ provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: 'sk-test', configured: true, ...patch })
const headers = (seen: Seen) => seen.init.headers as Record<string, string>

test('pixels follow the aspect, the width asked for, and what the service takes', () => {
  assert.deepEqual(pixels('landscape', 1200, { step: 16, min: 256, max: 1536 }), { width: 1200, height: 800 })
  assert.deepEqual(pixels('portrait', 600, { step: 16, min: 256, max: 1536 }), { width: 608, height: 896 })
  assert.deepEqual(pixels('wide', undefined, { step: 64, min: 128, max: 2048 }), { width: 1024, height: 576 })
  assert.deepEqual(pixels('tall', undefined, { step: 64, min: 128, max: 2048 }), { width: 576, height: 1024 })
  assert.deepEqual(pixels('square', 4000, { step: 32, min: 256, max: 1440 }), { width: 1440, height: 1440 })
  assert.deepEqual(pixels('wide', 100, { step: 64, min: 128, max: 2048 }), { width: 256, height: 128 }, 'the short side is kept at the least')
})

test('an OpenAI-style service gets a size it knows, and a picture comes back as data or as an address', async () => {
  const official = service([json({ data: [{ b64_json: b64 }] })])
  const made = await generateImage(settings({}), { prompt: 'Ein Hof im Sommer', aspect: 'landscape' }, official.deps)
  assert.deepEqual([...made.bytes], [...PNG])
  assert.equal(official.seen[0].url, 'https://api.openai.com/v1/images/generations')
  assert.equal(headers(official.seen[0]).authorization, 'Bearer sk-test')
  assert.deepEqual(official.seen[0].body, { model: 'gpt-image-1', prompt: 'Ein Hof im Sommer', n: 1, size: '1536x1024' })
  const tall = service([json({ data: [{ url: 'https://cdn.example.org/a.png' }] })])
  assert.equal((await generateImage(settings({ model: 'dall-e-3' }), { prompt: 'x', aspect: 'tall' }, tall.deps)).size, '1024x1792')
  const other = service([json({ data: [{ b64_json: b64 }] })])
  await generateImage(settings({ baseURL: 'https://api.together.xyz/v1/', model: 'black-forest-labs/FLUX.1-schnell' }), { prompt: 'x', aspect: 'wide', width: 1000 }, other.deps)
  assert.equal(other.seen[0].url, 'https://api.together.xyz/v1/images/generations')
  assert.deepEqual(other.seen[0].body, { model: 'black-forest-labs/FLUX.1-schnell', prompt: 'x', n: 1, size: '1008x560', width: 1008, height: 560 })
  await assert.rejects(() => generateImage(settings({}), { prompt: 'x', aspect: 'square' }, service([json({ data: [] })]).deps), /without a picture/)
})

test('Google makes a picture with Gemini by generateContent and with Imagen by predict', async () => {
  const gemini = service([json({ candidates: [{ content: { parts: [{ text: 'Hier:' }, { thought: true, inlineData: { data: 'AAAA' } }, { inlineData: { data: b64 } }] } }] })])
  const made = await generateImage(settings({ provider: 'google', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash-image' }), { prompt: 'Ein Plakat', aspect: 'portrait' }, gemini.deps)
  assert.deepEqual([...made.bytes], [...PNG])
  assert.equal(gemini.seen[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent')
  assert.equal(headers(gemini.seen[0])['x-goog-api-key'], 'sk-test')
  assert.deepEqual(gemini.seen[0].body, { contents: [{ parts: [{ text: 'Ein Plakat' }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '2:3' } } })
  const imagen = service([json({ predictions: [{ bytesBase64Encoded: b64 }] })])
  await generateImage(settings({ provider: 'google', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'imagen-4.0-generate-001' }), { prompt: 'x', aspect: 'landscape' }, imagen.deps)
  assert.equal(imagen.seen[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict')
  assert.deepEqual(imagen.seen[0].body, { instances: [{ prompt: 'x' }], parameters: { sampleCount: 1, aspectRatio: '4:3' } })
  await assert.rejects(() => generateImage(settings({ provider: 'google', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash-image' }), { prompt: 'x', aspect: 'square' }, service([json({ promptFeedback: { blockReason: 'SAFETY' } })]).deps), /The prompt was blocked: SAFETY/)
})

test('FLUX from Black Forest Labs is a job: it is started, asked about, and fetched when ready', async () => {
  const bfl = settings({ provider: 'bfl', baseURL: 'https://api.bfl.ai/v1', model: 'flux-pro-1.1' })
  const ok = service([json({ id: 'job1', polling_url: 'https://api.bfl.ai/v1/get_result?id=job1' }), json({ status: 'Pending' }), json({ status: 'Ready', result: { sample: 'https://delivery.example.org/a.png' } })])
  const made = await generateImage(bfl, { prompt: 'Eine Wiese', aspect: 'wide', width: 1200 }, ok.deps)
  assert.deepEqual([...made.bytes], [...PNG])
  assert.equal(ok.seen[0].url, 'https://api.bfl.ai/v1/flux-pro-1.1')
  assert.equal(headers(ok.seen[0])['x-key'], 'sk-test')
  assert.deepEqual(ok.seen[0].body, { prompt: 'Eine Wiese', width: 1216, height: 672 })
  assert.equal(ok.seen.length, 3)
  assert.equal(headers(ok.seen[1])['x-key'], 'sk-test')
  await assert.rejects(() => generateImage(bfl, { prompt: 'x', aspect: 'square' }, service([json({ id: 'j', polling_url: 'https://api.bfl.ai/v1/get_result?id=j' }), json({ status: 'Content Moderated' })]).deps), /stopped the job: Content Moderated/)
  const slow = service([json({ id: 'j', polling_url: 'https://api.bfl.ai/v1/get_result?id=j' }), ...Array.from({ length: 50 }, () => () => json({ status: 'Pending' }))])
  await assert.rejects(() => generateImage(bfl, { prompt: 'x', aspect: 'square' }, { ...slow.deps, waitMs: 30 }), /not ready in time/)
})

test('Runware gets one task, by the model id, and gives the picture as an address or as data', async () => {
  const run = settings({ provider: 'runware', baseURL: 'https://api.runware.ai/v1', model: 'runware:101@1' })
  const first = service([json({ data: [{ taskType: 'imageInference', imageURL: 'https://im.runware.ai/a.jpg' }] })])
  const made = await generateImage(run, { prompt: 'Ein Haus', aspect: 'landscape', width: 1000 }, first.deps)
  assert.deepEqual([...made.bytes], [...PNG])
  assert.equal(first.seen[0].url, 'https://api.runware.ai/v1')
  assert.equal(headers(first.seen[0]).authorization, 'Bearer sk-test')
  const task = (first.seen[0].body as Record<string, unknown>[])[0]
  assert.deepEqual({ ...task, taskUUID: typeof task.taskUUID }, { taskType: 'imageInference', taskUUID: 'string', model: 'runware:101@1', positivePrompt: 'Ein Haus', width: 1024, height: 640, numberResults: 1 })
  const data = service([json({ data: [{ imageBase64Data: b64 }] })])
  assert.deepEqual([...(await generateImage(run, { prompt: 'x', aspect: 'square' }, data.deps)).bytes], [...PNG])
  await assert.rejects(() => generateImage(run, { prompt: 'x', aspect: 'square' }, service([json({ errors: [{ message: 'Unknown model' }] })]).deps), /Runware gave no picture: Unknown model/)
})

test('a refusal is told in the service\'s words, a bad key says so, and a service that is not set up says that', async () => {
  const refused = service([json({ error: { message: 'Billing hard limit reached' } }, 400)])
  await assert.rejects(() => generateImage(settings({}), { prompt: 'x', aspect: 'square' }, refused.deps), /The image service answered 400: Billing hard limit reached/)
  await assert.rejects(() => generateImage(settings({}), { prompt: 'x', aspect: 'square' }, service([new Response('nope', { status: 401 })]).deps), /answered 401: nope The key was refused/)
  assert.match(serviceError('Runware', 429, JSON.stringify({ errors: [{ message: 'Too many requests' }] })).message, /Runware answered 429: Too many requests/)
  await assert.rejects(() => generateImage(settings({ configured: false }), { prompt: 'x', aspect: 'square' }), /No image service is set up/)
  await assert.rejects(() => generateImage(settings({}), { prompt: '  ', aspect: 'square' }, service([]).deps), /prompt is empty/)
  await assert.rejects(() => generateImage(settings({}), { prompt: 'x', aspect: 'square' }, service([new Response('<html>', { status: 200 })]).deps), /did not answer with JSON/)
})
