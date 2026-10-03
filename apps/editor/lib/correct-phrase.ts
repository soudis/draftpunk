export function phraseChange(before: string, after: string): { old: string; next: string } | null {
  if (before === after) return null
  let start = 0
  const limit = Math.min(before.length, after.length)
  while (start < limit && before[start] === after[start]) start += 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }
  while (start > 0 && isWord(before[start - 1]) && isWord(after[start - 1])) start -= 1
  while (endBefore < before.length && endAfter < after.length && isWord(before[endBefore]) && isWord(after[endAfter])) {
    endBefore += 1
    endAfter += 1
  }
  const old = before.slice(start, endBefore)
  const next = after.slice(start, endAfter)
  if (!old.trim()) return null
  return { old, next }
}

function isWord(ch: string | undefined): boolean {
  return Boolean(ch && /[\p{L}\p{N}]/u.test(ch))
}
