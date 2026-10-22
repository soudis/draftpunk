// The look of a public page, read from the rendered page: colors by role, type, shape, and the sequence of sections.

export type RawSection = {
  tag: string
  height: number
  bg: string
  heading: string
  images: number
  headings: number
  buttons: number
  paragraphs: number
  links: number
  repeat: number
}

export type RawProfile = {
  title: string
  lang: string
  themeColor: string
  pageBg: string
  text: { color: string; share: number }[]
  headingColors: Record<string, { color: string; on: string }>
  linkColor: string
  areas: { color: string; share: number }[]
  headerBg: string
  footerBg: string
  buttons: { bg: string; color: string; radius: number; text: string }[]
  fonts: Record<string, { family: string; size: number; weight: string; lineHeight: string; transform: string; spacing: string }>
  faces: string[]
  buttonRadius: number
  cardRadius: number
  shadows: boolean
  contentWidth: number
  sectionGap: number
  nav: { links: { text: string; href: string }[]; dropdowns: boolean; logo: string }
  heroImage: string
  sections: RawSection[]
}

// Runs inside the page. A string, so a build step cannot rewrite it.
export const PROFILE_SOURCE = `(() => {
  if (!document.body || document.body.children.length === 0) return { empty: true }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const cache = new Map()
  const rgba = (color) => {
    if (cache.has(color)) return cache.get(color)
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    const v = [d[0], d[1], d[2], d[3] / 255]
    cache.set(color, v); return v
  }
  const hex = (c) => '#' + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, '0')).join('')
  const mix = (top, bottom) => [0, 1, 2].map((i) => top[3] * top[i] + (1 - top[3]) * bottom[i])
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    const cs = getComputedStyle(el)
    return cs.display !== 'none' && cs.visibility === 'visible' && Number(cs.opacity) > 0.1
  }
  const backdrop = (el) => {
    const layers = []
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      const c = rgba(cs.backgroundColor)
      if (c[3] > 0) layers.push(c)
      if (c[3] >= 1) break
    }
    let base = [255, 255, 255]
    for (let i = layers.length - 1; i >= 0; i--) base = mix(layers[i], base)
    return hex(base)
  }
  const first = (family) => String(family).split(',')[0].trim().replace(/^["']|["']$/g, '')
  const pageBg = (() => { const b = rgba(getComputedStyle(document.body).backgroundColor); const h = rgba(getComputedStyle(document.documentElement).backgroundColor); return hex(b[3] > 0.5 ? b : h[3] > 0.5 ? h : [255, 255, 255, 1]) })()
  const all = [...document.querySelectorAll('body *')].filter(visible).slice(0, 4000)
  const pageArea = Math.max(1, document.documentElement.scrollWidth * document.documentElement.scrollHeight)
  const areas = new Map()
  const texts = new Map()
  const anyTexts = new Map()
  let textTotal = 0
  let anyTotal = 0
  const buttonRadii = new Map()
  const cardRadii = new Map()
  let shadowed = 0
  let cards = 0
  for (const el of all) {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const bg = rgba(cs.backgroundColor)
    if (bg[3] >= 0.9 && cs.backgroundImage === 'none') {
      const key = hex(bg)
      // Only where the color changes, so a box inside a box of the same color is not counted twice.
      if (key !== (el.parentElement ? backdrop(el.parentElement) : pageBg)) areas.set(key, (areas.get(key) || 0) + Math.min(1, (r.width * r.height) / pageArea))
    }
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ')
    if (own.length > 2) {
      const behind = backdrop(el)
      const key = hex(mix(rgba(cs.color), rgba(behind)))
      anyTexts.set(key, (anyTexts.get(key) || 0) + own.length)
      anyTotal += own.length
      if (behind === pageBg && el.closest('a, nav, header, footer') === null) { texts.set(key, (texts.get(key) || 0) + own.length); textTotal += own.length }
    }
    if (r.width > 40 && r.height > 24) {
      const radius = Math.round(parseFloat(cs.borderTopLeftRadius) || 0)
      if (el.matches('button, [role=button], a[class*=btn i], a[class*=button i]')) buttonRadii.set(radius, (buttonRadii.get(radius) || 0) + 1)
      else if ((el.matches('[class*=card i]') && !el.querySelector('[class*=card i]')) || (el.tagName === 'IMG' && r.width > 120)) {
        cardRadii.set(radius, (cardRadii.get(radius) || 0) + 1)
        if (el.tagName !== 'IMG') { cards++; if (cs.boxShadow !== 'none') shadowed++ }
      }
    }
  }
  const top = (map, n, total) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([color, value]) => ({ color, share: total ? Math.round((value / total) * 100) / 100 : Math.round(value * 100) / 100 }))
  const headingColors = {}
  for (const tag of ['h1', 'h2', 'h3']) {
    const el = [...document.querySelectorAll(tag)].find(visible)
    if (el) headingColors[tag] = { color: hex(mix(rgba(getComputedStyle(el).color), rgba(backdrop(el)))), on: backdrop(el) }
  }
  const contentLinks = [...document.querySelectorAll('main a, article a, p a')].filter(visible).filter((a) => a.textContent.trim().length > 3 && !a.closest('nav, header, footer') && !a.matches('[class*=btn i], [class*=button i]'))
  const links = contentLinks.length > 0 ? contentLinks : [...document.querySelectorAll('body a')].filter(visible).filter((a) => a.textContent.trim().length > 3)
  const linkCounts = new Map()
  for (const a of links.slice(0, 200)) { const k = hex(mix(rgba(getComputedStyle(a).color), rgba(backdrop(a)))); linkCounts.set(k, (linkCounts.get(k) || 0) + 1) }
  const buttons = [...document.querySelectorAll('button, [type=submit], [role=button], a[class*=btn i], a[class*=button i]')].filter(visible).slice(0, 12).map((el) => {
    const cs = getComputedStyle(el)
    return { bg: rgba(cs.backgroundColor)[3] > 0.5 ? hex(rgba(cs.backgroundColor)) : '', color: hex(rgba(cs.color)), radius: Math.round(parseFloat(cs.borderTopLeftRadius) || 0), text: el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 24) }
  }).filter((b) => b.bg && b.text)
  const fonts = {}
  const fontOf = (name, selector) => {
    const el = [...document.querySelectorAll(selector)].find(visible)
    if (!el) return
    const cs = getComputedStyle(el)
    fonts[name] = { family: first(cs.fontFamily), size: Math.round(parseFloat(cs.fontSize) * 10) / 10, weight: cs.fontWeight, lineHeight: cs.lineHeight === 'normal' ? 'normal' : String(Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)) * 100) / 100), transform: cs.textTransform, spacing: cs.letterSpacing === 'normal' ? '' : cs.letterSpacing }
  }
  fontOf('body', 'main p, article p, p'); fontOf('h1', 'h1'); fontOf('h2', 'h2'); fontOf('h3', 'h3'); fontOf('nav', 'header nav a, nav a'); fontOf('button', 'button, [role=button], a[class*=btn i], a[class*=button i]')
  const faces = [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')))].slice(0, 6)
  const header = document.querySelector('header') || document.querySelector('nav')
  const footer = document.querySelector('footer')
  const kidsOf = (el) => [...el.children].filter((e) => visible(e) && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(e.tagName))
  // Themes wrap the page in a few divs. Go inside a wrapper until the page splits into its sections.
  const flatten = (el, depth) => {
    const kids = kidsOf(el)
    const out = []
    for (const k of kids) {
      if (k === header || k === footer) continue
      const holdsChrome = (header && k.contains(header)) || (footer && k.contains(footer))
      const wrapper = kids.length <= 2 && depth < 5 && k.getBoundingClientRect().height > 300 && kidsOf(k).length > 1
      if (holdsChrome || wrapper) out.push(...flatten(k, depth + 1))
      else out.push(k)
    }
    return out
  }
  const sectionEls = flatten(document.querySelector('main') || document.body, 0).filter((el) => el.getBoundingClientRect().height > 60)
  const section = (el) => {
    const h = [...el.querySelectorAll('h1, h2, h3')].find(visible)
    let repeat = 0
    for (const parent of [el, ...el.querySelectorAll('div, ul, section')].slice(0, 80)) {
      const kids = [...parent.children].filter(visible)
      const keyOf = (k) => k.tagName + '.' + (typeof k.className === 'string' ? k.className.trim().split(/\\s+/)[0] : '')
      const counts = new Map()
      for (const k of kids) counts.set(keyOf(k), (counts.get(keyOf(k)) || 0) + 1)
      for (const [, n] of counts) if (n > repeat && n <= 12) repeat = n
    }
    return {
      tag: el.tagName.toLowerCase(), height: Math.round(el.getBoundingClientRect().height), bg: backdrop(el),
      heading: h ? h.textContent.trim().replace(/\\s+/g, ' ').slice(0, 50) : '',
      images: el.querySelectorAll('img, picture, svg[role=img]').length, headings: el.querySelectorAll('h2, h3').length,
      buttons: [...el.querySelectorAll('button, [role=button], a[class*=btn i], a[class*=button i]')].filter(visible).length,
      paragraphs: el.querySelectorAll('p').length, links: el.querySelectorAll('a').length, repeat,
    }
  }
  const sections = []
  if (header && visible(header)) sections.push(section(header))
  for (const el of sectionEls) sections.push(section(el))
  if (footer && visible(footer)) sections.push(section(footer))
  const pads = sectionEls.slice(0, 12).map((el) => { const inner = el.firstElementChild; return Math.max(parseFloat(getComputedStyle(el).paddingTop) || 0, inner ? parseFloat(getComputedStyle(inner).paddingTop) || 0 : 0) }).filter((v) => v > 0).sort((a, b) => a - b)
  const maxWidths = new Map()
  for (const el of sectionEls.slice(0, 12)) for (const e of [el, ...el.querySelectorAll(':scope > *, :scope > * > *')].slice(0, 60)) { const m = getComputedStyle(e).maxWidth; if (m.endsWith('px') && parseFloat(m) > 300) maxWidths.set(Math.round(parseFloat(m)), (maxWidths.get(Math.round(parseFloat(m))) || 0) + 1) }
  const widths = sectionEls.slice(0, 12).map((el) => { const c = el.firstElementChild; return c ? Math.round(c.getBoundingClientRect().width) : 0 }).filter((w) => w > 300 && w < window.innerWidth - 8).sort((a, b) => a - b)
  const nav = document.querySelector('header nav, nav')
  const logo = (header || document).querySelector('img')
  const heroImg = [...document.images].filter((i) => visible(i) && !i.closest('header, nav, footer') && i.getBoundingClientRect().width > 200 && i.getBoundingClientRect().height > 100 && i.getBoundingClientRect().top < window.innerHeight * 1.5).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0]
  const mode = (map, fallback) => { const best = [...map.entries()].sort((a, b) => b[1] - a[1])[0]; return best ? best[0] : fallback }
  return {
    title: document.title, lang: document.documentElement.lang || '', themeColor: (document.querySelector('meta[name=theme-color]') || {}).content || '',
    pageBg, text: texts.size > 0 ? top(texts, 3, textTotal) : top(anyTexts, 3, anyTotal), headingColors, linkColor: [...linkCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)[0] || '',
    areas: top(areas, 6, 0), headerBg: header ? backdrop(header) : '', footerBg: footer ? backdrop(footer) : '',
    buttons, fonts, faces, buttonRadius: mode(buttonRadii, -1), cardRadius: mode(cardRadii, -1),
    shadows: cards > 2 && shadowed / cards > 0.4, contentWidth: maxWidths.size > 0 ? mode(maxWidths, 0) : widths.length ? widths[Math.floor(widths.length / 2)] : 0, sectionGap: pads.length ? Math.round(pads[Math.floor(pads.length / 2)]) : 0,
    nav: { links: nav ? [...nav.querySelectorAll('a')].filter(visible).slice(0, 12).map((a) => ({ text: a.textContent.trim().replace(/\\s+/g, ' ').slice(0, 24), href: a.href })).filter((l) => l.text) : [], dropdowns: nav ? !!nav.querySelector('ul ul, [aria-haspopup], details, [class*=dropdown i], [class*=sub-menu i]') : false, logo: logo ? (logo.currentSrc || logo.src) : '' },
    heroImage: heroImg ? (heroImg.currentSrc || heroImg.src) : '',
    sections: sections.slice(0, 14),
  }
})()`

function kinds(sections: RawSection[], pageBg: string, viewportHeight: number): string[] {
  let heroSeen = false
  return sections.map((section, index) => {
    if (section.tag === 'header' || (index === 0 && section.tag === 'nav')) return 'header'
    if (section.tag === 'footer') return 'footer'
    if (!heroSeen && (section.heading || section.images > 0) && (section.height >= viewportHeight * 0.45 || (section.bg !== pageBg && section.height >= 200))) {
      heroSeen = true
      return 'hero'
    }
    if (section.repeat >= 3 && section.headings + section.images >= 3) return `${section.repeat} cards`
    if (section.images >= 4) return 'picture grid'
    if (section.buttons >= 1 && section.paragraphs <= 2 && section.height < 420) return 'call to action'
    if (section.paragraphs >= 2) return 'text'
    return 'section'
  })
}

const pct = (share: number) => `${Math.round(share * 100)}%`

/** A profile a model can use, about 500 tokens. */
export function formatProfile(url: string, raw: RawProfile, viewportHeight = 800): string {
  if ((raw as { empty?: boolean }).empty) throw new Error(`${url} shows nothing to read. It may need a login, block automated readers, or send you somewhere else.`)
  const lines: string[] = []
  const host = new URL(url).hostname.replace(/^www\./, '')
  lines.push(`# ${host}`, `${raw.title}${raw.lang ? ` (${raw.lang})` : ''}${raw.themeColor ? `, theme color ${raw.themeColor}` : ''}`)
  const colors = [`page ${raw.pageBg}`]
  if (raw.text[0]) colors.push(`text ${raw.text[0].color}`)
  const headings = Object.entries(raw.headingColors).map(([tag, item]) => `${tag} ${item.color}${item.on === raw.pageBg ? '' : ` on ${item.on}`}`)
  if (headings.length > 0) colors.push(`headings ${headings.join(', ')}`)
  if (raw.linkColor) colors.push(`links ${raw.linkColor}`)
  if (raw.headerBg) colors.push(`header ${raw.headerBg}`)
  if (raw.footerBg) colors.push(`footer ${raw.footerBg}`)
  lines.push(`Colors: ${colors.join('; ')}.`)
  const button = raw.buttons[0]
  if (button) lines.push(`Buttons: ${button.bg} with ${button.color} text (“${button.text}”).`)
  const areas = raw.areas.filter((area) => area.color !== raw.pageBg && area.share >= 0.03).slice(0, 4)
  if (areas.length > 0) lines.push(`Other large color areas: ${areas.map((area) => `${area.color} (${pct(area.share)})`).join(', ')}.`)
  const fontLine = (name: string, label: string) => {
    const f = raw.fonts[name]
    if (!f) return ''
    const extras = [f.transform !== 'none' ? f.transform : '', f.spacing].filter(Boolean).join(' ')
    return `${label} ${f.family} ${f.size}px${f.weight !== '400' ? ` ${f.weight}` : ''}${f.lineHeight !== 'normal' && name === 'body' ? `, line ${f.lineHeight}` : ''}${extras ? `, ${extras}` : ''}`
  }
  lines.push(`Type: ${['body', 'h1', 'h2', 'h3', 'nav', 'button'].map((name) => fontLine(name, name)).filter(Boolean).join('; ')}.`)
  if (raw.faces.length > 0) lines.push(`Fonts loaded: ${raw.faces.join(', ')}.`)
  const shape: string[] = []
  if (raw.buttonRadius >= 0) shape.push(`button corners ${raw.buttonRadius}px`)
  if (raw.cardRadius >= 0) shape.push(`card and picture corners ${raw.cardRadius}px`, raw.shadows ? 'cards have shadows' : 'cards have no shadows')
  if (raw.contentWidth) shape.push(`content up to ${raw.contentWidth}px wide`)
  if (raw.sectionGap) shape.push(`sections have about ${raw.sectionGap}px of padding above`)
  if (shape.length > 0) lines.push(`Shape: ${shape.join(', ')}.`)
  if (raw.nav.links.length > 0) {
    lines.push(`Menu: ${raw.nav.links.map((link) => link.text).join(' · ')}${raw.nav.dropdowns ? ' (with drop-down menus)' : ''}.${raw.nav.logo ? ` Logo: ${raw.nav.logo}` : ''}`)
  }
  if (raw.heroImage) lines.push(`Main picture: ${raw.heroImage}`)
  const sectionKinds = kinds(raw.sections, raw.pageBg, viewportHeight)
  lines.push(raw.sections.length >= 14 ? 'Page, top to bottom (the first 14 sections):' : 'Page, top to bottom:')
  raw.sections.forEach((section, index) => {
    const parts = [`${sectionKinds[index]}`, `${section.bg === raw.pageBg ? 'page color' : section.bg}`, `${section.height}px`]
    if (section.heading) parts.push(`“${section.heading}”`)
    if (section.images > 0 && !/cards|grid/.test(sectionKinds[index])) parts.push(`${section.images} picture${section.images > 1 ? 's' : ''}`)
    if (section.buttons > 0) parts.push(`${section.buttons} button${section.buttons > 1 ? 's' : ''}`)
    lines.push(`${index + 1}. ${parts.join(', ')}`)
  })
  return lines.join('\n')
}
