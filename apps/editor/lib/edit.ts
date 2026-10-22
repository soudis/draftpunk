import { fail } from './tool-kit'

function occurrences(source: string, find: string): number {
  let count = 0
  let from = 0
  while (from <= source.length) {
    const at = source.indexOf(find, from)
    if (at < 0) break
    count += 1
    from = at + find.length
  }
  return count
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace text that appears once. A change that cannot be placed exactly says why: the text is not
 * there, it differs in spacing, or it appears more than once and needs more around it.
 */
export function replaceOnce(source: string, find: string, replace: string, label: string, all = false): { text: string; count: number } {
  if (find === '') fail(`${label}: find is empty.`)
  const count = occurrences(source, find)
  if (count === 0) {
    const loose = new RegExp(find.trim().split(/\s+/).map(escapeRegExp).join('\\s+')).exec(source)
    if (loose) fail(`${label}: no exact match. The text is there with different spacing or line breaks: ${JSON.stringify(loose[0].slice(0, 200))}. Copy it exactly.`)
    fail(`${label}: that text is not there. Read it again and copy the part to change.`)
  }
  if (count > 1 && !all) fail(`${label}: that text appears ${count} times. Add surrounding text so it appears once, or set all to true to replace every one.`)
  return { text: all ? source.split(find).join(replace) : source.replace(find, () => replace), count }
}
