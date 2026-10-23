import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type { Attr, Element, Node } from '@xmldom/xmldom'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** What an SVG of a site may hold: shapes, text, gradients, patterns, clips, masks, filters and styles. Everything else is dropped with what is in it. */
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'image', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker',
  'style', 'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting',
  'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur',
  'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
  'animateTransform', 'animateMotion', 'animate', 'mpath',
])

/** A link is only to a part of the same file, or (for a picture) to a small embedded raster picture or a picture of the site. */
const FRAGMENT = /^#[\w.:-]+$/
const EMBEDDED = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i
const SITE_PICTURE = /^\/media\/[\w./-]+$/

export type SvgReport = { svg: string; removed: string[] }

/** CSS escapes can spell `url(` or `import` past a filter, so they are read first. */
function unescapeCss(css: string): string {
  return css.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_all, hex: string) => {
    const code = Number.parseInt(hex, 16)
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
  }).replace(/\\(.)/g, '$1')
}

function cleanCss(css: string, removed: Set<string>): string {
  let text = unescapeCss(css).replace(/\/\*[\s\S]*?\*\//g, '')
  const before = text
  text = text.replace(/@import[^;]*;?/gi, '').replace(/expression\s*\([^)]*\)/gi, 'none').replace(/(?:behavior|-moz-binding)\s*:[^;}]*/gi, '')
  text = text.replace(/url\(\s*(["']?)([\s\S]*?)\1\s*\)/gi, (whole, _quote: string, target: string) => {
    const wanted = target.trim()
    return FRAGMENT.test(wanted) || EMBEDDED.test(wanted) ? whole : 'none'
  })
  if (text !== before) removed.add('an address in a style')
  return text
}

function cleanElement(node: Element, removed: Set<string>): void {
  const children = Array.from(node.childNodes as unknown as ArrayLike<Node>)
  let unwrapped = false
  for (const child of children) {
    if (child.nodeType === 1) {
      const element = child as Element
      const name = element.localName || element.nodeName
      const namespace = element.namespaceURI
      // A link around a shape is not kept, the shape is.
      if (name === 'a' && (!namespace || namespace === SVG_NS)) {
        while (element.firstChild) node.insertBefore(element.firstChild, element)
        node.removeChild(element)
        removed.add('a')
        unwrapped = true
        continue
      }
      if (!ELEMENTS.has(name) || (namespace && namespace !== SVG_NS)) {
        node.removeChild(child)
        removed.add(name)
        continue
      }
      if (!cleanAttributes(element, removed)) {
        node.removeChild(child)
        continue
      }
      cleanElement(element, removed)
      if (name === 'style') {
        const type = element.getAttribute('type')
        if (type && type !== 'text/css') {
          node.removeChild(child)
          removed.add('style')
          continue
        }
        const css = element.textContent ?? ''
        while (element.firstChild) element.removeChild(element.firstChild)
        element.appendChild(element.ownerDocument!.createTextNode(cleanCss(css, removed)))
      }
    } else if (child.nodeType === 3 || child.nodeType === 4) {
      continue
    } else {
      node.removeChild(child)
    }
  }
  if (unwrapped) cleanElement(node, removed)
}

/** Drop what could run or reach another place. Returns false when the whole element has to go. */
function cleanAttributes(element: Element, removed: Set<string>): boolean {
  const name = element.localName || element.nodeName
  for (const attribute of Array.from(element.attributes as unknown as ArrayLike<Attr>)) {
    const key = attribute.name
    const lower = key.toLowerCase()
    const value = attribute.value
    const drop = () => {
      element.removeAttribute(key)
      removed.add(key)
    }
    if (lower.startsWith('on')) {
      drop()
    } else if (lower === 'href' || lower === 'xlink:href') {
      const target = value.trim()
      const picture = name === 'image' && (EMBEDDED.test(target) || SITE_PICTURE.test(target))
      if (!FRAGMENT.test(target) && !picture) {
        if (name === 'use') return false
        drop()
      }
    } else if (lower === 'style') {
      element.setAttribute(key, cleanCss(value, removed))
    } else if (lower.startsWith('xmlns')) {
      if (value !== SVG_NS && value !== XLINK_NS) drop()
    } else if (key.includes(':') && !lower.startsWith('xlink:') && !lower.startsWith('xml:')) {
      drop()
    } else {
      const read = unescapeCss(value)
      if (/javascript:|vbscript:|data:text|data:application/i.test(read) || /url\(\s*["']?(?!#)/i.test(read)) drop()
    }
  }
  // A picture that points nowhere any more is not kept.
  if (name === 'image' && !element.hasAttribute('href') && !element.hasAttribute('xlink:href')) return false
  if ((name === 'animate' || name === 'animateTransform' || name === 'animateMotion') && /href/i.test(element.getAttribute('attributeName') ?? '')) return false
  return true
}

/**
 * An SVG made safe to keep on a site. Script, `foreignObject`, event attributes, links to another host or file,
 * editor data and animations of a link are removed; shapes, gradients, clips, masks, filters and styles stay.
 * The result is the same file as far as a picture is concerned. A file that is not an SVG, or not well formed, throws.
 */
export function sanitizeSvg(source: string): SvgReport {
  let text = source.replace(/^﻿/, '')
  if (/<!ENTITY/i.test(text)) throw new Error('That SVG defines entities, which are not allowed.')
  text = text.replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<\?(?!xml[\s?])[\s\S]*?\?>/g, '')
  const problems: string[] = []
  let document: ReturnType<DOMParser['parseFromString']>
  try {
    document = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') problems.push(message)
      },
    }).parseFromString(text, 'image/svg+xml')
  } catch {
    throw new Error('That is not a well formed SVG.')
  }
  const root = document.documentElement as Element | null
  if (problems.length > 0 || !root || (root.localName || root.nodeName) !== 'svg') throw new Error('That is not a well formed SVG.')
  const removed = new Set<string>()
  if (!cleanAttributes(root, removed)) throw new Error('That is not a well formed SVG.')
  cleanElement(root, removed)
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', SVG_NS)
  const svg = new XMLSerializer().serializeToString(document).replace(/^<\?xml[^>]*\?>\s*/, '')
  return { svg, removed: [...removed].sort() }
}
