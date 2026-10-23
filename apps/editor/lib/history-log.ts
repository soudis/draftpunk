import { checkoutFile, checkoutTree, commitAll, commitPath, fileAt, git, isAncestor, KIND_TRAILER, worktreeClean, type GitAuthor } from './git'
import { parentOf, revisionChanges, type RevisionChange } from './changes'
import { undoRevisionChecked } from './draft'

export type HistoryKind = 'initial' | 'reply' | 'edit' | 'publish' | 'restore' | 'undo' | 'picture' | 'change'

export type HistoryEntry = {
  revision: string
  short: string
  author: string
  /** The email the change was made under; it tells apart two people with the same name. */
  authorEmail: string
  date: string
  subject: string
  kind: HistoryKind
  /** The public site is at this change. */
  isPublic: boolean
  /** The newest change of the draft. */
  isHead: boolean
}

const KINDS = new Set<HistoryKind>(['reply', 'edit', 'publish', 'restore', 'picture'])
const HEX = /^[0-9a-f]{7,40}$/

/** Revisions arrive from the browser, so only a hash of a change that is in the draft is used. */
export function knownRevision(root: string, revision: unknown): string {
  if (typeof revision !== 'string' || !HEX.test(revision)) throw new Error('That is not a change of the draft.')
  let full: string
  try {
    full = git(root, ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]).trim()
  } catch {
    throw new Error('That is not a change of the draft.')
  }
  if (!isAncestor(root, full)) throw new Error('That change is no longer in the draft.')
  return full
}

/** Commits older than the trailers are told apart by what their message says. */
export function kindOf(subject: string, trailer: string): HistoryKind {
  const named = trailer.trim() as HistoryKind
  if (KINDS.has(named)) return named
  if (subject === 'Initial site') return 'initial'
  if (/^Revert "/.test(subject)) return 'undo'
  if (/^(Save|Update|Discard) picture /.test(subject)) return 'picture'
  if (/^Corrected text in /.test(subject)) return 'edit'
  return 'change'
}

export function listHistory(root: string, skip = 0, limit = 50): { entries: HistoryEntry[]; total: number } {
  const total = Number(git(root, ['rev-list', '--count', 'draft']).trim()) || 0
  const publicRevision = git(root, ['rev-parse', 'main']).trim()
  const raw = git(root, [
    'log',
    'draft',
    `--skip=${Math.max(0, skip)}`,
    `--max-count=${Math.min(200, Math.max(1, limit))}`,
    `--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%(trailers:key=${KIND_TRAILER},valueonly,separator=%x2c)%x1e`,
  ])
  const headRevision = git(root, ['rev-parse', 'draft']).trim()
  const entries = raw
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [revision, author, authorEmail, date, subject, trailer] = record.split('\x1f')
      return {
        revision,
        short: revision.slice(0, 7),
        author,
        authorEmail,
        date,
        subject,
        kind: kindOf(subject, trailer ?? ''),
        isPublic: revision === publicRevision,
        isHead: revision === headRevision,
      }
    })
  return { entries, total }
}

export function commitDetail(root: string, revision: string): { entry: HistoryEntry; changes: RevisionChange[] } {
  const full = knownRevision(root, revision)
  const { entries } = listHistory(root, 0, 200)
  const found = entries.find((entry) => entry.revision === full) ?? singleEntry(root, full)
  return { entry: found, changes: revisionChanges(root, parentOf(root, full), full) }
}

function singleEntry(root: string, revision: string): HistoryEntry {
  const raw = git(root, ['show', '-s', `--format=%an%x1f%ae%x1f%aI%x1f%s%x1f%(trailers:key=${KIND_TRAILER},valueonly,separator=%x2c)`, revision]).replace(/\n$/, '')
  const [author, authorEmail, date, subject, trailer] = raw.split('\x1f')
  return {
    revision,
    short: revision.slice(0, 7),
    author,
    authorEmail,
    date,
    subject,
    kind: kindOf(subject, trailer ?? ''),
    isPublic: revision === git(root, ['rev-parse', 'main']).trim(),
    isHead: revision === git(root, ['rev-parse', 'draft']).trim(),
  }
}

const DIFF_LIMIT = 120_000

/** The lines one change made to one file. */
export function fileDiff(root: string, revision: string, file: string): { text: string; cut: boolean } {
  const full = knownRevision(root, revision)
  const safe = safeFile(file)
  const text = git(root, ['diff', '--no-renames', '--unified=3', parentOf(root, full), full, '--', safe])
  return text.length > DIFF_LIMIT ? { text: text.slice(0, DIFF_LIMIT), cut: true } : { text, cut: false }
}

/** A picture as one change had it (after) or as its parent had it (before). */
export function pictureAt(root: string, revision: string, file: string, side: 'before' | 'after'): { bytes: Buffer; mediaType: string } | null {
  const full = knownRevision(root, revision)
  const safe = safeFile(file)
  const extension = /\.(jpe?g|png|webp|gif|svg)$/i.exec(safe)?.[1]?.toLowerCase()
  if (!safe.startsWith('media/') || !extension) throw new Error('Only pictures can be shown.')
  try {
    const bytes = fileAt(root, side === 'before' ? parentOf(root, full) : full, safe)
    const mediaType = extension === 'svg' ? 'image/svg+xml' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`
    return { bytes, mediaType }
  } catch {
    return null
  }
}

function safeFile(file: unknown): string {
  if (typeof file !== 'string') throw new Error('Name a file.')
  const normalized = file.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || normalized.startsWith('-')) {
    throw new Error('That is not a file of the site.')
  }
  return normalized
}

export type HistoryResult = { ok: true; revision: string } | { ok: false; error: string }

function busy(root: string): string | null {
  return worktreeClean(root) ? null : 'A reply is changing files right now. Try again when it is done.'
}

/** What a restore would change, in sentences, for the person to confirm. */
export function restorePreview(root: string, revision: string, file?: string): string[] {
  const full = knownRevision(root, revision)
  const changes = revisionChanges(root, 'draft', full)
  const wanted = file ? changes.filter((change) => change.file === safeFile(file)) : changes
  return wanted.map((change) => change.sentence)
}

/** Put the whole draft back to how it was at a change. It becomes a new change; nothing is dropped. */
export function restoreDraft(root: string, revision: string, author: GitAuthor): HistoryResult {
  const full = knownRevision(root, revision)
  const wait = busy(root)
  if (wait) return { ok: false, error: wait }
  const subject = git(root, ['show', '-s', '--format=%s', full]).trim()
  try {
    checkoutTree(root, full)
  } catch {
    return { ok: false, error: 'The draft could not be restored.' }
  }
  const made = commitAll(root, `Restored the draft to ${full.slice(0, 7)}: ${subject}`, author, 'restore')
  if (!made) return { ok: false, error: 'The draft is already like that.' }
  return { ok: true, revision: made }
}

/** Put one file back to how it was at a change. */
export function restoreFile(root: string, revision: string, file: string, author: GitAuthor): HistoryResult {
  const full = knownRevision(root, revision)
  const safe = safeFile(file)
  const wait = busy(root)
  if (wait) return { ok: false, error: wait }
  try {
    checkoutFile(root, full, safe)
  } catch {
    return { ok: false, error: 'That file could not be restored.' }
  }
  const made = commitPath(root, safe, `Restored ${safe} to ${full.slice(0, 7)}`, author, 'restore')
  if (!made) return { ok: false, error: 'That file is already like that.' }
  return { ok: true, revision: made }
}

/** Take back what one change did, as long as no later change edited the same files. */
export function undoChange(root: string, revision: string, author: GitAuthor): HistoryResult {
  const full = knownRevision(root, revision)
  const wait = busy(root)
  if (wait) return { ok: false, error: wait }
  const result = undoRevisionChecked(root, author, full)
  if (!result.undone) return { ok: false, error: result.error }
  return { ok: true, revision: git(root, ['rev-parse', 'draft']).trim() }
}
