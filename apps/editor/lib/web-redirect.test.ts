import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import test from 'node:test'
import { closeBrowser, getBrowser } from './browser'
import { withSitePage } from './web-render'

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file))

// A test site is on this machine, so the test reaches it with a fetch that allows that. The real one would refuse.
const localFetch = (url: string, init: RequestInit) => fetch(url, { ...init, redirect: 'manual' })

function serve(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      if (request.url === '/newsletter') {
        response.writeHead(301, { location: '/newsletter/' })
        response.end()
        return
      }
      if (request.url === '/alt.svg') {
        response.writeHead(302, { location: '/foto.svg' })
        response.end()
        return
      }
      if (request.url === '/foto.svg') {
        response.writeHead(200, { 'content-type': 'image/svg+xml' })
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#999"/></svg>')
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>Newsletter</title><h1>Newsletter</h1><img src="/alt.svg" alt="Foto">')
    })
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() }))
  })
}

test('a page that redirects on its own site is read, and so is a picture that redirects', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  const site = await serve()
  try {
    const result = await withSitePage(`${site.url}/newsletter`, { fetchPage: localFetch }, async (page, url) => ({
      url,
      title: await page.title(),
      imageWidth: await page.evaluate("document.querySelector('img').naturalWidth"),
    }))
    assert.equal(result.url, `${site.url}/newsletter/`)
    assert.equal(result.title, 'Newsletter')
    assert.equal(result.imageWidth, 40)
  } finally {
    await closeBrowser()
    site.close()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})

test('a page that redirects to a site that cannot be read says so, not that the page is missing', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  const fetchPage = async (url: string) => {
    if (url.startsWith('https://expired.example')) throw new Error('certificate has expired')
    return new Response(null, { status: 301, headers: { location: 'https://expired.example/subscription/abc' } })
  }
  try {
    await assert.rejects(
      () => withSitePage('https://old.example/newsletter', { fetchPage }, async () => 'x'),
      /Could not read https:\/\/old\.example\/newsletter: it redirects to https:\/\/expired\.example\/subscription\/abc, which could not be read: certificate has expired\. That is another site; this page itself is there\./,
    )
  } finally {
    await closeBrowser()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})

function internalServer(): Promise<{ port: number; hits: string[]; close: () => void }> {
  const hits: string[] = []
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      hits.push(request.url ?? '')
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<title>internal</title><h1>SECRET</h1>')
    })
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as { port: number }).port, hits, close: () => server.close() }))
  })
}

test('a page cannot send the browser to an address on this machine with a redirect', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  const internal = await internalServer()
  // The reader's own fetch refuses any address that is not public; the page itself is a public one.
  const fetchPage = async (url: string) => {
    if (url.startsWith('https://public.example')) return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${internal.port}/secret` } })
    throw new Error('is not a public website')
  }
  try {
    await assert.rejects(() => withSitePage('https://public.example/go', { fetchPage }, async () => 'x'), /redirects to http:\/\/127\.0\.0\.1:\d+\/secret, which could not be read: is not a public website/)
    // A redirect on a picture or a script inside a page is stopped the same way.
    const page = '<!doctype html><title>Seite</title><h1>Seite</h1><img src="/bild.png">'
    const inside = async (url: string) => {
      if (url === 'https://public.example/') return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } })
      if (url === 'https://public.example/bild.png') return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${internal.port}/pixel` } })
      throw new Error('is not a public website')
    }
    assert.equal(await withSitePage('https://public.example/', { fetchPage: inside }, async (browserPage) => browserPage.title()), 'Seite')
    assert.deepEqual(internal.hits, [])
  } finally {
    await closeBrowser()
    internal.close()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})

test('a browser that is launched here has no network of its own', { skip: CHROME ? false : 'no Chrome on this machine' }, async () => {
  process.env.BROWSER_PATH = CHROME
  process.env.BROWSER_NO_SANDBOX = '1'
  const internal = await internalServer()
  try {
    const context = await (await getBrowser()).newContext()
    const page = await context.newPage()
    // No route here: whatever the page asks for goes to the browser's own network.
    await page.goto(`http://127.0.0.1:${internal.port}/direct`, { timeout: 5_000 }).catch(() => undefined)
    await page.goto('http://example.com/', { timeout: 5_000 }).catch(() => undefined)
    assert.deepEqual(internal.hits, [])
    assert.equal(await page.evaluate('document.body ? document.body.innerText.includes("SECRET") : false'), false)
    await context.close()
  } finally {
    await closeBrowser()
    internal.close()
    delete process.env.BROWSER_PATH
    delete process.env.BROWSER_NO_SANDBOX
  }
})
