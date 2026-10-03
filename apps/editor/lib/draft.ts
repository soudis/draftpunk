import type Database from 'better-sqlite3'
import { commitFiles, filesChangedSince, isAncestor, revertDraftToPublic, revisionsMatch, undoRevision, git, type GitAuthor } from './git'
import { clearReplyCommit, editorDatabase, replyCommit } from './sessions'

export function undoLastReply(
  root: string,
  author: GitAuthor,
  database: Database.Database = editorDatabase(),
): { undone: true } | { undone: false; error: string } {
  const row = replyCommit(database)
  if (!row) return { undone: false, error: 'Nothing to undo.' }
  if (!isAncestor(root, row.revision)) {
    clearReplyCommit(database)
    return { undone: false, error: 'That reply is no longer in the draft.' }
  }
  const own = new Set(commitFiles(root, row.revision))
  const overlap = filesChangedSince(root, row.revision).filter((file) => own.has(file))
  if (overlap.length > 0) {
    return { undone: false, error: `A later change edited ${overlap.slice(0, 3).join(', ')}.` }
  }
  try {
    undoRevision(root, row.revision, author)
  } catch {
    return { undone: false, error: 'That reply could not be undone.' }
  }
  clearReplyCommit(database)
  return { undone: true }
}

export function revertDraft(root: string, database: Database.Database = editorDatabase()): { reverted: true } | { reverted: false; error: string } {
  if (revisionsMatch(root) && !git(root, ['status', '--porcelain']).trim()) {
    return { reverted: false, error: 'The draft already matches the public site.' }
  }
  revertDraftToPublic(root)
  clearReplyCommit(database)
  return { reverted: true }
}
