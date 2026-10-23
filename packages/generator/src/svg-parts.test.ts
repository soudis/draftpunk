import assert from 'node:assert/strict'
import test from 'node:test'
import { editSvg, extractSvg, fitSvg, normalizeColor, outlineSvg, svgBox } from './svg-parts'

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="200pt" height="100pt">
  <style>.dot{fill:#ff0000}</style>
  <defs>
    <linearGradient id="sky"><stop offset="0" stop-color="#00f"/><stop offset="1" stop-color="rgb(0, 255, 0)"/></linearGradient>
    <clipPath id="round"><circle cx="75" cy="25" r="20"/></clipPath>
    <linearGradient id="unused"><stop offset="0" stop-color="#123456"/></linearGradient>
  </defs>
  <g id="left" transform="translate(5 5)"><rect id="box" x="0" y="0" width="30" height="30" fill="red"/><circle class="dot" cx="40" cy="15" r="5"/></g>
  <g id="right" clip-path="url(#round)"><rect x="55" y="5" width="40" height="40" fill="url(#sky)"/></g>
</svg>`

test('the outline numbers every element and says what is in a group of many', () => {
  const outline = outlineSvg(SAMPLE)
  assert.match(outline, /^\d+ elements\. View box 0 0 100 50, width 200pt, height 100pt\./)
  assert.match(outline, /@0 svg/)
  assert.match(outline, /@\d+ g #left transform=translate\(5 5\)/)
  assert.match(outline, /@\d+ rect #box fill=red x=0 y=0 width=30 height=30/)
  assert.match(outline, /@\d+ circle \.dot cx=40/)
  const many = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g>${'<path d="M0 0L1 1"/>'.repeat(30)}</g></svg>`
  const long = outlineSvg(many)
  assert.match(long, /… 23 more path elements, @9 to @31 \(use under:"@1" to list them\)/)
  assert.ok(long.split('\n').length < 14)
  const listed = outlineSvg(many, { under: '@1' })
  assert.match(listed, /@1 g/)
  assert.match(listed, /@31 path/)
})

test('an extract keeps the groups a part sits in, what it uses, and nothing else', () => {
  const { svg, kept } = extractSvg(SAMPLE, ['#box'])
  assert.ok(svg.includes('id="left"') && svg.includes('transform="translate(5 5)"'), 'the group and its transform stay')
  assert.ok(svg.includes('id="box"'))
  assert.equal(svg.includes('class="dot"'), false, 'a sibling is gone')
  assert.equal(svg.includes('id="right"') || svg.includes('id="sky"') || svg.includes('id="round"'), false)
  assert.ok(svg.includes('.dot{fill:#ff0000}'), 'styles stay whole')
  assert.ok(kept >= 3)
  const second = extractSvg(SAMPLE, ['#right']).svg
  assert.ok(second.includes('id="sky"') && second.includes('id="round"') && second.includes('stop-color="#00f"'), 'gradient and clip it uses stay')
  assert.equal(second.includes('id="unused"'), false)
  assert.equal(second.includes('id="box"'), false)
  assert.ok(extractSvg(SAMPLE, ['circle']).svg.includes('class="dot"'))
  assert.throws(() => extractSvg(SAMPLE, ['#nothing']), /Nothing in the SVG matches #nothing/)
  assert.throws(() => extractSvg(SAMPLE, ['a > b']), /is not a selector/)
})

test('the view box fits a part and the size follows', () => {
  assert.deepEqual(svgBox(SAMPLE), { x: 0, y: 0, width: 100, height: 50 })
  const fitted = fitSvg(SAMPLE, { x: 5, y: 5, width: 40, height: 20 })
  assert.match(fitted, /viewBox="5 5 40 20"/)
  assert.match(fitted, /width="512" height="256"/)
  assert.deepEqual(svgBox('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="6"/>'), { x: 0, y: 0, width: 12, height: 6 })
  assert.throws(() => svgBox('<svg xmlns="http://www.w3.org/2000/svg"/>'), /size is not known/)
})

test('colours are matched however they are written, and edits say what they did', () => {
  assert.equal(normalizeColor('#F00'), '#ff0000')
  assert.equal(normalizeColor('rgb(0, 255, 0)'), '#00ff00')
  assert.equal(normalizeColor('Red'), '#ff0000')
  assert.equal(normalizeColor('url(#a)'), null)
  const recolored = editSvg(SAMPLE, [{ op: 'recolor', from: '#ff0000', to: '#1f5f54' }])
  assert.match(recolored.svg, /fill="#1f5f54"/, 'the word red')
  assert.ok(recolored.svg.includes('.dot{fill:#1f5f54}'), 'a style')
  assert.ok(recolored.svg.includes('stop-color="#00f"'), 'other colours are left')
  assert.match(recolored.notes[0], /recolor: 2 colours changed to #1f5f54/)
  const all = editSvg(SAMPLE, [{ op: 'recolor', from: '*', to: '#000000' }])
  assert.equal(/#00f|#ff0000|rgb\(/.test(all.svg), false)
  assert.ok(all.svg.includes('fill="url(#sky)"'), 'a reference is not a colour')
  assert.match(editSvg(SAMPLE, [{ op: 'recolor', from: '#ff0000', to: '#111111', select: ['#left'] }]).svg, /\.dot\{fill:#ff0000\}/, 'a style of the whole drawing is not in the part')
  const removed = editSvg(SAMPLE, [{ op: 'remove', select: ['#right'] }, { op: 'set', attr: 'opacity', value: '0.5', select: ['#left'] }, { op: 'viewbox', x: 0, y: 0, width: 50, height: 50 }])
  assert.equal(removed.svg.includes('id="right"'), false)
  assert.ok(removed.svg.includes('opacity="0.5"') && removed.svg.includes('viewBox="0 0 50 50"'))
  assert.deepEqual(removed.notes, ['remove: 1 element removed.', 'set: opacity on 1 element.', 'viewbox: now 0 0 50 50.'])
  assert.throws(() => editSvg(SAMPLE, [{ op: 'set', attr: 'onclick', value: 'x()', select: ['#left'] }]), /set can change/)
  assert.throws(() => editSvg(SAMPLE, [{ op: 'recolor', to: 'url(#a)' }]), /colour such as/)
  assert.throws(() => editSvg(SAMPLE, [{ op: 'set', attr: 'fill', value: 'red', select: ['@999'] }]), /Nothing in the SVG/)
})
