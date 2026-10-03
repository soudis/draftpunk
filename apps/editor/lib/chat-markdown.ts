export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'a'; text: string; href: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }

export type ListItem = { inlines: Inline[]; nested: Block[] }

export type Block =
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'h'; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: 'ul'; items: ListItem[] }
  | { kind: 'ol'; items: ListItem[] }
  | { kind: 'pre'; text: string }

export function parseChatMarkdown(source: string): Block[] {
  return readBlocks(source.replace(/\r\n/g, '\n').split('\n'))
}

function readBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trimStart().startsWith('```')) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ kind: 'pre', text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      index += 1
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line.trim())
    if (heading && !line.startsWith(' ')) {
      blocks.push({ kind: 'h', level: heading[1].length as 1 | 2 | 3, inlines: parseInlines(heading[2] ?? '') })
      index += 1
      continue
    }
    const list = readList(lines, index)
    if (list) {
      blocks.push(list.block)
      index = list.next
      continue
    }
    const paragraph = [line.trim()]
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() && !blockStart(lines[index] ?? '')) {
      paragraph.push((lines[index] ?? '').trim())
      index += 1
    }
    blocks.push({ kind: 'p', inlines: parseInlines(paragraph.join(' ')) })
  }
  return blocks
}

function readList(lines: string[], start: number): { block: Block; next: number } | null {
  const first = listMatch(lines[start] ?? '')
  if (!first) return null
  const items: ListItem[] = []
  let index = start
  while (index < lines.length) {
    const match = listMatch(lines[index] ?? '')
    if (!match || match.kind !== first.kind || match.indent !== first.indent) break
    index += 1
    const nested: string[] = []
    while (index < lines.length) {
      const line = lines[index] ?? ''
      if (!line.trim()) {
        const ahead = lines[index + 1] ?? ''
        const aheadMatch = listMatch(ahead)
        if (aheadMatch && aheadMatch.indent > first.indent) {
          index += 1
          continue
        }
        break
      }
      const inner = listMatch(line)
      if (inner && inner.indent <= first.indent) break
      if (!line.startsWith(' ') && !line.startsWith('\t')) break
      nested.push(line)
      index += 1
    }
    items.push({ inlines: parseInlines(match.text), nested: nested.length ? readBlocks(dedent(nested)) : [] })
  }
  return { block: { kind: first.kind, items }, next: index }
}

function listMatch(line: string): { indent: number; kind: 'ul' | 'ol'; text: string } | null {
  const match = /^( *)(?:[-*]|\d+\.)\s+(.*)$/.exec(line)
  if (!match) return null
  const indent = match[1]?.length ?? 0
  const kind = /^\d+\./.test(line.slice(indent)) ? 'ol' : 'ul'
  return { indent, kind, text: match[2] ?? '' }
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^ */)?.[0].length ?? 0)
  const amount = Math.min(...indents)
  return lines.map((line) => (line.startsWith(' '.repeat(amount)) ? line.slice(amount) : line.trimStart()))
}

function blockStart(line: string): boolean {
  return line.trimStart().startsWith('```') || /^(#{1,3})\s+/.test(line.trim()) || listMatch(line) !== null
}

function parseInlines(source: string): Inline[] {
  const inlines: Inline[] = []
  let rest = source
  while (rest) {
    const code = /^`([^`]+)`/.exec(rest)
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)
    const strong = /^\*\*([^*]+)\*\*/.exec(rest)
    const em = /^\*([^*]+)\*/.exec(rest)
    const href = link ? safeHref(link[2] ?? '') : null
    if (code) {
      inlines.push({ kind: 'code', text: code[1] ?? '' })
      rest = rest.slice(code[0].length)
      continue
    }
    if (link && href) {
      inlines.push({ kind: 'a', text: link[1] ?? '', href })
      rest = rest.slice(link[0].length)
      continue
    }
    if (strong) {
      inlines.push({ kind: 'strong', children: parseInlines(strong[1] ?? '') })
      rest = rest.slice(strong[0].length)
      continue
    }
    if (em) {
      inlines.push({ kind: 'em', children: parseInlines(em[1] ?? '') })
      rest = rest.slice(em[0].length)
      continue
    }
    const next = rest.slice(1).search(/[`*\[]/)
    const take = next === -1 ? rest.length : next + 1
    pushText(inlines, rest.slice(0, take))
    rest = rest.slice(take)
  }
  return inlines
}

function pushText(inlines: Inline[], text: string) {
  const last = inlines.at(-1)
  if (last?.kind === 'text') last.text += text
  else inlines.push({ kind: 'text', text })
}

function safeHref(href: string): string | null {
  if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) return null
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') return null
    return url.href
  } catch {
    return null
  }
}
