// The readable text of a public page, as markdown with picture and link addresses, read from the rendered page.
// Scripts have run, so text that a script adds or decodes (an email address, a lazy picture) is in it.

export type RawText = { title: string; markdown: string; headings: string[]; empty?: boolean }

// Runs inside the page. A string, so a build step cannot rewrite it.
export const TEXT_SOURCE = `(() => {
  if (!document.body) return { empty: true, title: '', markdown: '', headings: [] }
  const SKIP = 'script, style, noscript, template, svg, iframe, canvas, nav, header, footer, aside, form, select, [role=navigation], [role=banner], [role=contentinfo], [role=search], [aria-hidden=true], [hidden]'
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return cs.display !== 'none' && cs.visibility !== 'hidden' && (r.width > 0 || r.height > 0 || el.tagName === 'BR')
  }
  const abs = (value) => { try { return new URL(value, document.baseURI).href } catch { return '' } }
  const pick = () => {
    const named = document.querySelector('main, [role=main], article')
    if (named && named.innerText.trim().length > 40) return named
    let best = document.body, score = 0
    for (const el of document.body.querySelectorAll('div, section')) {
      if (el.matches(SKIP) || el.closest('nav, header, footer, aside')) continue
      const own = [...el.children].filter((c) => /^(P|H[1-6]|UL|OL|BLOCKQUOTE|TABLE|FIGURE)$/.test(c.tagName)).reduce((n, c) => n + c.innerText.length, 0)
      if (own > score) { score = own; best = el }
    }
    return best
  }
  const inline = (node) => {
    let out = ''
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out += child.textContent.replace(/\\s+/g, ' '); continue }
      if (child.nodeType !== 1) continue
      const el = child
      if (el.matches(SKIP) || !shown(el)) continue
      const tag = el.tagName
      if (tag === 'BR') { out += '\\n'; continue }
      if (tag === 'IMG') { const src = picture(el); if (src) out += '![' + (el.alt || '').replace(/\\]/g, '') + '](' + src + ')'; continue }
      const text = inline(el)
      if (!text.trim()) continue
      if (tag === 'A') { const href = el.getAttribute('href') || ''; const url = /^(mailto:|tel:)/i.test(href) ? href : /^javascript:/i.test(href) || href.startsWith('#') ? '' : abs(href); out += url ? '[' + text.trim() + '](' + url + ')' : text; continue }
      if (tag === 'STRONG' || tag === 'B') { out += '**' + text.trim() + '** '; continue }
      if (tag === 'EM' || tag === 'I') { out += '*' + text.trim() + '* '; continue }
      out += text
    }
    return out
  }
  const picture = (img) => {
    const r = img.getBoundingClientRect()
    if (r.width < 40 || r.height < 40) return ''
    const src = img.currentSrc || img.src
    return src && !src.startsWith('data:') ? src : ''
  }
  const blocks = []
  const walk = (el) => {
    for (const child of el.children) {
      if (child.matches(SKIP) || !shown(child)) continue
      const tag = child.tagName
      if (/^H[1-6]$/.test(tag)) { const t = inline(child).replace(/\\s+/g, ' ').trim(); if (t) blocks.push('#'.repeat(Number(tag[1])) + ' ' + t); continue }
      if (tag === 'P' || tag === 'FIGCAPTION' || tag === 'SUMMARY') { const t = inline(child).replace(/[ \\t]+/g, ' ').trim(); if (t) blocks.push(t); continue }
      if (tag === 'UL' || tag === 'OL') {
        const items = [...child.children].filter((li) => li.tagName === 'LI' && shown(li)).map((li, i) => (tag === 'OL' ? i + 1 + '. ' : '- ') + inline(li).replace(/\\s+/g, ' ').trim()).filter((l) => l.length > 3)
        if (items.length) blocks.push(items.join('\\n'))
        continue
      }
      if (tag === 'BLOCKQUOTE') { const t = inline(child).replace(/\\s+/g, ' ').trim(); if (t) blocks.push('> ' + t); continue }
      if (tag === 'HR') { blocks.push('---'); continue }
      if (tag === 'IMG') { const src = picture(child); if (src) blocks.push('![' + (child.alt || '') + '](' + src + ')'); continue }
      if (tag === 'TABLE') {
        const rows = [...child.querySelectorAll('tr')].map((tr) => '| ' + [...tr.children].map((c) => inline(c).replace(/\\s+/g, ' ').trim()).join(' | ') + ' |')
        if (rows.length) blocks.push(rows.join('\\n'))
        continue
      }
      const hasBlocks = child.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote, img')
      if (hasBlocks) { walk(child); continue }
      const t = inline(child).replace(/[ \\t]+/g, ' ').trim()
      if (t) blocks.push(t)
    }
  }
  walk(pick())
  if (blocks.length === 0) walk(document.body)
  const markdown = blocks.join('\\n\\n').replace(/\\n{3,}/g, '\\n\\n')
  return { title: document.title, markdown, headings: blocks.filter((b) => /^#{1,3} /.test(b)).slice(0, 20) }
})()`

export function formatText(url: string, raw: RawText): string {
  if (raw.empty || !raw.markdown.trim()) throw new Error(`${url} shows no text to read. It may need a login, block automated readers, or be made of pictures.`)
  return `URL: ${url}\nTitle: ${raw.title}\n\n${raw.markdown}`
}
