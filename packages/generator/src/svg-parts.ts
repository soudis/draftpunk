import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type { Document, Element, Node } from '@xmldom/xmldom'
import { sanitizeSvg } from './svg'

/**
 * Parts of an SVG, for an agent that cannot see markup: a numbered outline, a copy of chosen parts with what they need
 * (the groups they sit in, the gradients and clips they use), and plain edits (colours, removal, size). All of it works
 * on the cleaned text of a file (svg.ts), and its result is cleaned again.
 */

export type SvgBox = { x: number; y: number; width: number; height: number }

function load(svg: string): { document: Document; root: Element } {
  const document = new DOMParser().parseFromString(sanitizeSvg(svg).svg, 'image/svg+xml')
  return { document, root: document.documentElement as Element }
}

function save(document: Document): string {
  return sanitizeSvg(new XMLSerializer().serializeToString(document)).svg
}

function elementsOf(node: Node, into: Element[] = []): Element[] {
  for (const child of Array.from(node.childNodes as unknown as ArrayLike<Node>)) {
    if (child.nodeType === 1) {
      into.push(child as Element)
      elementsOf(child, into)
    }
  }
  return into
}

const everything = (root: Element): Element[] => [root, ...elementsOf(root)]
const tagOf = (element: Element) => element.localName || element.nodeName
const childElements = (element: Element): Element[] => Array.from(element.childNodes as unknown as ArrayLike<Node>).filter((child) => child.nodeType === 1) as Element[]

/** The size of the drawing in its own units: the view box, else the width and height. */
export function svgBox(svg: string): SvgBox {
  const { root } = load(svg)
  return boxOf(root)
}

function boxOf(root: Element): SvgBox {
  const numbers = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2] > 0 && numbers[3] > 0) return { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] }
  const width = Number.parseFloat(root.getAttribute('width') ?? '')
  const height = Number.parseFloat(root.getAttribute('height') ?? '')
  if (width > 0 && height > 0) return { x: 0, y: 0, width, height }
  throw new Error('That SVG has no view box and no width and height, so its size is not known.')
}

/** Set what part of the drawing shows, in its own units. The width and height follow, so the longest side is `longest`. */
export function fitSvg(svg: string, box: SvgBox, longest = 512): string {
  const { document, root } = load(svg)
  root.setAttribute('viewBox', `${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}`)
  const scale = longest / Math.max(box.width, box.height)
  root.setAttribute('width', String(Math.max(1, Math.round(box.width * scale))))
  root.setAttribute('height', String(Math.max(1, Math.round(box.height * scale))))
  return save(document)
}

const round = (value: number) => Math.round(value * 1000) / 1000

function describe(element: Element, index: number): string {
  const tag = tagOf(element)
  const parts = [`@${index} ${tag}`]
  const id = element.getAttribute('id')
  const klass = element.getAttribute('class')
  if (id) parts.push(`#${id}`)
  if (klass) parts.push(`.${klass.trim().split(/\s+/).join('.')}`)
  for (const name of ['fill', 'stroke', 'transform', 'opacity']) {
    const value = element.getAttribute(name)
    if (value) parts.push(`${name}=${value.length > 40 ? `${value.slice(0, 40)}…` : value}`)
  }
  if (tag === 'path') parts.push(`(${(element.getAttribute('d') ?? '').length} chars)`)
  if (tag === 'text' || tag === 'tspan') parts.push(`"${(element.textContent ?? '').trim().slice(0, 40)}"`)
  if (tag === 'rect' || tag === 'circle' || tag === 'ellipse' || tag === 'line') {
    const shown = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry'].filter((name) => element.hasAttribute(name)).map((name) => `${name}=${element.getAttribute(name)}`)
    parts.push(shown.join(' '))
  }
  return parts.join(' ')
}

/**
 * The drawing as a tree, with a number for every element (`@12`) that the other tools take as a selector. A group with many
 * alike children shows the first few and says how many more; ask for a part of the tree with `under` to see inside it.
 */
export function outlineSvg(svg: string, options: { under?: string; limit?: number } = {}): string {
  const { root } = load(svg)
  const all = everything(root)
  const index = new Map(all.map((element, at) => [element, at]))
  const start = options.under ? selectSvg(root, [options.under])[0] : root
  const limit = options.limit ?? 70
  const box = boxOf(root)
  const lines: string[] = [
    `${all.length} elements. View box ${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}${root.getAttribute('width') ? `, width ${root.getAttribute('width')}, height ${root.getAttribute('height')}` : ''}.`,
  ]
  const walk = (element: Element, depth: number) => {
    if (lines.length >= limit) return
    lines.push(`${'  '.repeat(depth)}${describe(element, index.get(element) as number)}`)
    const kids = childElements(element)
    let shown = 0
    for (let at = 0; at < kids.length; at += 1) {
      const same = !(element === start && options.under) && at > 6 && kids.slice(at - 6, at + 1).every((kid) => tagOf(kid) === tagOf(kids[at]))
      if (same && kids.length - at > 3) {
        const first = index.get(kids[at]) as number
        const last = index.get(kids[kids.length - 1]) as number
        lines.push(`${'  '.repeat(depth + 1)}… ${kids.length - at} more ${tagOf(kids[at])} elements, @${first} to @${last} (use under:"@${index.get(element)}" to list them)`)
        return
      }
      walk(kids[at], depth + 1)
      shown += 1
    }
    void shown
  }
  walk(start, 0)
  if (lines.length >= limit) lines.push('… the outline stops here. Ask for a part of it with under.')
  return lines.join('\n')
}

/** Elements by `@12`, `@12-20` (a range of numbers), `#id`, `.class` or a tag name such as `path`. */
export function selectSvg(root: Element, selectors: string[]): Element[] {
  const all = everything(root)
  const found = new Set<Element>()
  for (const raw of selectors) {
    const selector = raw.trim()
    const range = /^@(\d+)(?:-(\d+))?$/.exec(selector)
    if (range) {
      const from = Number(range[1])
      const to = range[2] === undefined ? from : Number(range[2])
      for (let at = from; at <= to && at < all.length; at += 1) found.add(all[at])
    } else if (selector.startsWith('#')) {
      for (const element of all) if (element.getAttribute('id') === selector.slice(1)) found.add(element)
    } else if (selector.startsWith('.')) {
      for (const element of all) if ((element.getAttribute('class') ?? '').split(/\s+/).includes(selector.slice(1))) found.add(element)
    } else if (/^[A-Za-z][\w-]*$/.test(selector)) {
      for (const element of all) if (tagOf(element) === selector) found.add(element)
    } else {
      throw new Error(`"${selector}" is not a selector. Use @12, @12-20, #id, .class or a tag name such as path.`)
    }
  }
  if (found.size === 0) throw new Error(`Nothing in the SVG matches ${selectors.join(', ')}. Call svg_outline for the numbers.`)
  return [...found]
}

function referencesIn(element: Element): string[] {
  const ids: string[] = []
  const scan = (text: string) => {
    for (const match of text.matchAll(/url\(\s*["']?#([\w.:-]+)/g)) ids.push(match[1])
  }
  for (const attribute of Array.from(element.attributes as unknown as ArrayLike<{ name: string; value: string }>)) {
    scan(attribute.value)
    if ((attribute.name === 'href' || attribute.name === 'xlink:href') && attribute.value.startsWith('#')) ids.push(attribute.value.slice(1))
  }
  return ids
}

/**
 * A copy of the drawing that holds only the chosen elements, the groups they sit in (with their transforms, clips and styles),
 * and the gradients, patterns, clips, masks and symbols they use. Styles stay whole.
 */
export function extractSvg(svg: string, selectors: string[]): { svg: string; kept: number } {
  const { document, root } = load(svg)
  const chosen = selectSvg(root, selectors)
  const all = everything(root)
  const byId = new Map<string, Element>()
  for (const element of all) {
    const id = element.getAttribute('id')
    if (id) byId.set(id, element)
  }
  const keep = new Set<Element>()
  const keepWithin = (element: Element) => {
    keep.add(element)
    for (const child of elementsOf(element)) keep.add(child)
  }
  const keepAbove = (element: Element) => {
    for (let node = element.parentNode as Element | null; node && node.nodeType === 1; node = node.parentNode as Element | null) keep.add(node)
  }
  for (const element of chosen) {
    keepWithin(element)
    keepAbove(element)
  }
  for (const element of all) if (tagOf(element) === 'style') keep.add(element)
  const done = new Set<Element>()
  let again = true
  while (again) {
    again = false
    for (const element of [...keep]) {
      if (done.has(element)) continue
      done.add(element)
      for (const id of referencesIn(element)) {
        const target = byId.get(id)
        if (target && !keep.has(target)) {
          keepWithin(target)
          keepAbove(target)
          again = true
        }
      }
    }
  }
  const prune = (element: Element) => {
    for (const child of childElements(element)) {
      if (!keep.has(child)) element.removeChild(child)
      else prune(child)
    }
  }
  prune(root)
  const kept = everything(root).length - 1
  return { svg: save(document), kept }
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080',
  pink: '#ffc0cb', gray: '#808080', grey: '#808080', brown: '#a52a2a', cyan: '#00ffff', magenta: '#ff00ff',
}

/** A colour as six hex digits, or null when it is not one (none, currentColor, url(...)). */
export function normalizeColor(value: string): string | null {
  const text = value.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  if (/^#[0-9a-f]{6}$/.test(text)) return text
  const rgb = /^rgb\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)$/.exec(text)
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')}`
  return NAMED[text] ?? null
}

const COLOR_PROPERTIES = ['fill', 'stroke', 'stop-color', 'flood-color', 'color']
const COLOR_TOKEN = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b|rgb\(\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*\)|\b(?:black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|cyan|magenta)\b/g

export type SvgEdit = {
  op: 'recolor' | 'remove' | 'set' | 'viewbox'
  from?: string
  to?: string
  select?: string[]
  attr?: string
  value?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

const SETTABLE = new Set(['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'class', 'id', 'display', 'visibility'])

/** Plain edits, in order. The result says what each did, so an edit that did nothing is not silent. */
export function editSvg(svg: string, edits: SvgEdit[]): { svg: string; notes: string[] } {
  const { document, root } = load(svg)
  const notes: string[] = []
  for (const edit of edits) {
    if (edit.op === 'recolor') {
      if (!edit.to || !normalizeColor(edit.to)) throw new Error(`recolor needs "to" as a colour such as #1f5f54, not ${edit.to ?? 'nothing'}.`)
      const target = normalizeColor(edit.to) as string
      const wanted = !edit.from || edit.from === '*' ? null : normalizeColor(edit.from)
      if (edit.from && edit.from !== '*' && !wanted) throw new Error(`recolor "from" must be a colour such as #ff8b8b, or * for every colour. Got ${edit.from}.`)
      const scope = edit.select?.length ? selectSvg(root, edit.select).flatMap((element) => [element, ...elementsOf(element)]) : everything(root)
      let changed = 0
      const swap = (text: string) => text.replace(COLOR_TOKEN, (token) => {
        const found = normalizeColor(token)
        if (found && (wanted === null || found === wanted)) {
          changed += 1
          return target
        }
        return token
      })
      for (const element of scope) {
        for (const name of COLOR_PROPERTIES) {
          const value = element.getAttribute(name)
          if (value && !/^(?:none|currentcolor|inherit)$/i.test(value.trim()) && normalizeColor(value)) {
            const next = swap(value)
            if (next !== value) element.setAttribute(name, next)
          }
        }
        const style = element.getAttribute('style')
        if (style) element.setAttribute('style', swap(style))
        if (tagOf(element) === 'style') element.textContent = swap(element.textContent ?? '')
      }
      notes.push(`recolor: ${changed} colour${changed === 1 ? '' : 's'} changed to ${target}.`)
    } else if (edit.op === 'remove') {
      const found = selectSvg(root, edit.select ?? [])
      for (const element of found) element.parentNode?.removeChild(element)
      notes.push(`remove: ${found.length} element${found.length === 1 ? '' : 's'} removed.`)
    } else if (edit.op === 'set') {
      if (!edit.attr || !SETTABLE.has(edit.attr)) throw new Error(`set can change: ${[...SETTABLE].join(', ')}. Got ${edit.attr ?? 'nothing'}.`)
      if (edit.value === undefined) throw new Error('set needs a value.')
      const found = edit.select?.length ? selectSvg(root, edit.select) : [root]
      for (const element of found) element.setAttribute(edit.attr, edit.value)
      notes.push(`set: ${edit.attr} on ${found.length} element${found.length === 1 ? '' : 's'}.`)
    } else if (edit.op === 'viewbox') {
      if ([edit.x, edit.y, edit.width, edit.height].some((value) => typeof value !== 'number') || (edit.width ?? 0) <= 0 || (edit.height ?? 0) <= 0) throw new Error('viewbox needs x, y, width and height as numbers, in the drawing\'s own units.')
      root.setAttribute('viewBox', `${edit.x} ${edit.y} ${edit.width} ${edit.height}`)
      notes.push(`viewbox: now ${edit.x} ${edit.y} ${edit.width} ${edit.height}.`)
    } else {
      throw new Error(`Unknown edit ${(edit as { op: string }).op}. Use recolor, remove, set or viewbox.`)
    }
  }
  return { svg: save(document), notes }
}
