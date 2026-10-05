export function documentOpacityRefusal(css: string): string | null {
  if (!hidesDocument(css)) return null
  return 'design/styles.css sets opacity 0 on html or body. The page stays blank. Fade an image, or reveal the page without hiding html or body.'
}

function hidesDocument(css: string): boolean {
  return walkRules(css.replace(/\/\*[\s\S]*?\*\//g, ''))
}

function walkRules(text: string): boolean {
  let index = 0
  while (index < text.length) {
    const open = text.indexOf('{', index)
    if (open === -1) return false
    const prelude = text.slice(index, open)
    const close = closeBrace(text, open)
    if (close === -1) return false
    const block = text.slice(open + 1, close)
    if (/^\s*@/u.test(prelude)) {
      if (walkRules(block)) return true
    } else if (selectorHidesDocument(prelude) && opacityZero(block)) {
      return true
    } else if (block.includes('{') && walkRules(block)) {
      return true
    }
    index = close + 1
  }
  return false
}

function closeBrace(text: string, open: number): number {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function selectorHidesDocument(prelude: string): boolean {
  return prelude.split(',').some((part) => {
    const pieces = part.trim().split(/\s*[>+~]\s*|\s+/u).filter(Boolean)
    const subject = pieces[pieces.length - 1] ?? ''
    return /^(?:html|body)(?![a-zA-Z0-9_-])/iu.test(subject)
  })
}

function opacityZero(block: string): boolean {
  return /(?:^|;)\s*opacity\s*:\s*0+(?:\.0+)?\s*(?:!important)?\s*(?:;|$)/iu.test(declarationsOnly(block))
}

function declarationsOnly(block: string): string {
  let out = ''
  let depth = 0
  for (const char of block) {
    if (char === '{') depth += 1
    else if (char === '}') depth = Math.max(0, depth - 1)
    else if (depth === 0) out += char
  }
  return out
}
