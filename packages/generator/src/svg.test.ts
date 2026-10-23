import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeSvg } from './svg'

const wrap = (inner: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"${attrs}>${inner}</svg>`

test('shapes, gradients, clips and styles stay as they are', () => {
  const input = wrap(
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><clipPath id="c"><circle cx="5" cy="5" r="4"/></clipPath><style>.a{fill:url(#g)}</style></defs><g clip-path="url(#c)"><rect class="a" width="10" height="10" fill="url(#g)"/></g><use xlink:href="#c"/><path d="M0 0L10 10" style="stroke:#000;fill:url(#g)"/>',
  )
  const { svg, removed } = sanitizeSvg(input)
  assert.deepEqual(removed, [])
  for (const part of ['<linearGradient id="g">', 'clip-path="url(#c)"', 'fill="url(#g)"', 'xlink:href="#c"', '.a{fill:url(#g)}', 'M0 0L10 10']) assert.ok(svg.includes(part), part)
  assert.ok(svg.startsWith('<svg'))
})

test('script, foreignObject, event handlers and links to elsewhere are taken out', () => {
  const { svg, removed } = sanitizeSvg(
    wrap(
      '<script>alert(1)</script><foreignObject><iframe src="https://x.test"/></foreignObject><a xlink:href="javascript:alert(1)"><rect onclick="x()" width="1" height="1" onload="y()"/></a><image href="https://x.test/p.png"/><use href="https://x.test/a.svg#b"/><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="xlink:href" to="x"/><rect fill="url(https://x.test/p)" width="2" height="2"/><circle r="1" style="background:url(http://x.test/a)"/>',
      ' onload="alert(2)"',
    ),
  )
  for (const gone of ['script', 'foreignObject', 'iframe', 'onclick', 'onload', 'javascript:', 'x.test', '<set', '<animate']) assert.equal(svg.includes(gone), false, gone)
  assert.ok(svg.includes('<circle') && svg.includes('<rect'), 'what is harmless stays')
  assert.ok(removed.includes('script') && removed.includes('foreignObject') && removed.includes('onclick') && removed.includes('onload'))
})

test('a picture inside an SVG may be a small embedded raster or a picture of the site, nothing else', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  const { svg } = sanitizeSvg(wrap(`<image href="${png}"/><image href="/media/hof.jpg"/><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/><image href="data:text/html;base64,PHNjcmlwdD4="/><image href="//evil.test/x.png"/>`))
  assert.equal((svg.match(/<image/g) ?? []).length, 2, 'the two allowed, and the others are gone with their link')
  assert.ok(svg.includes(png) && svg.includes('/media/hof.jpg'))
  assert.equal(/svg\+xml|text\/html|evil\.test/.test(svg), false)
})

test('a style cannot import, bind, or reach another place, even spelled with escapes', () => {
  const { svg } = sanitizeSvg(wrap('<style>@import url(https://x.test/a.css); .a{background:u\\72l(https://x.test/b);fill:url(#g)} .b{behavior:url(x.htc);-moz-binding:url(y)} .c{width:expression(alert(1))}</style><rect class="a" width="1" height="1"/>'))
  assert.equal(/x\.test|import|behavior|binding|expression|htc/i.test(svg), false)
  assert.ok(svg.includes('fill:url(#g)'))
})

test('editor data, processing instructions and a doctype are dropped, entities and other files are refused', () => {
  const dirty =
    '<?xml version="1.0"?>\n<?xml-stylesheet href="https://x.test/a.css"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1.2"><metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></metadata><inkscape:perspective id="p"/><rect inkscape:label="a" width="1" height="1"/></svg>'
  const { svg } = sanitizeSvg(dirty)
  assert.equal(/inkscape|metadata|rdf|xml-stylesheet|DOCTYPE|x\.test/.test(svg), false)
  assert.ok(svg.includes('<rect'))
  assert.throws(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>'), /entities/)
  assert.throws(() => sanitizeSvg('<html><body>hi</body></html>'), /not a well formed SVG/)
  assert.throws(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'), /not a well formed SVG/)
  assert.throws(() => sanitizeSvg('not xml at all'), /not a well formed SVG/)
})

test('a file without a namespace gets one, and text and its spacing are kept', () => {
  const { svg } = sanitizeSvg('<svg viewBox="0 0 10 10"><text x="1" y="5">Hof &amp; Haus</text></svg>')
  assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.ok(svg.includes('Hof &amp; Haus'))
})
