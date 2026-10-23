import type Database from 'better-sqlite3'
import { commitFiles, filesChangedSince, isAncestor, revertDraftToPublic, revisionsMatch, undoRevision, git, type GitAuthor } from './git'
import { clearReplyCommit, clearReplyCommits, editorDatabase, replyCommit } from './sessions'

/** Undo one reply. It works for any earlier reply, as long as no later change edited the files that reply changed. */
export function undoReply(
  root: string,
  author: GitAuthor,
  messageId: string,
  database: Database.Database = editorDatabase(),
): { undone: true } | { undone: false; error: string } {
  const row = replyCommit(database, messageId)
  if (!row) return { undone: false, error: 'Nothing to undo.' }
  if (!isAncestor(root, row.revision)) {
    clearReplyCommit(database, messageId)
    return { undone: false, error: 'That reply is no longer in the draft.' }
  }
  const result = undoRevisionChecked(root, author, row.revision)
  if (!result.undone) return result
  clearReplyCommit(database, messageId)
  return { undone: true }
}

export function revertDraft(root: string, database: Database.Database = editorDatabase()): { reverted: true } | { reverted: false; error: string } {
  if (revisionsMatch(root) && !git(root, ['status', '--porcelain']).trim()) {
    return { reverted: false, error: 'The draft already matches the public site.' }
  }
  revertDraftToPublic(root)
  clearReplyCommits(database)
  return { reverted: true }
}

/** Revert one change of the draft, as long as no later change edited the files it changed. */
export function undoRevisionChecked(root: string, author: GitAuthor, revision: string): { undone: true } | { undone: false; error: string } {
  const own = new Set(commitFiles(root, revision))
  const overlap = filesChangedSince(root, revision).filter((file) => own.has(file))
  if (overlap.length > 0) {
    return { undone: false, error: `A later change edited ${overlap.slice(0, 3).join(', ')}.` }
  }
  try {
    undoRevision(root, revision, author)
  } catch {
    return { undone: false, error: 'That change could not be undone.' }
  }
  return { undone: true }
}
