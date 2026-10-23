import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { initSite } from '@schlor/generator'

export type GitAuthor = { name: string; email: string }

/** What made a commit, kept as a trailer so that the history can say it. Older commits have none. */
export type CommitKind = 'reply' | 'edit' | 'publish' | 'restore' | 'picture'
export const KIND_TRAILER = 'Draftpunk-Kind'

function messageArgs(message: string, kind?: CommitKind): string[] {
  const args = ['-m', message.slice(0, 200)]
  if (kind) args.push('-m', `${KIND_TRAILER}: ${kind}`)
  return args
}

export function ensureGit(root: string, author: GitAuthor = { name: 'schloR editor', email: 'editor@schlor.org' }): void {
  fs.mkdirSync(root, { recursive: true })
  if (!fs.existsSync(path.join(root, 'design', 'shell.njk'))) initSite(root)
  const ignore = path.join(root, '.gitignore')
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, 'dist\npublished\ndist.tmp\npublished.tmp\n')
  if (!fs.existsSync(path.join(root, '.git'))) {
    git(root, ['init', '-b', 'draft'])
    commitAll(root, 'Initial site', author)
    git(root, ['branch', 'main'])
  }
}

export function commitAll(root: string, message: string, author: GitAuthor, kind?: CommitKind): string | null {
  git(root, ['add', '-A'])
  const status = git(root, ['status', '--porcelain']).trim()
  if (!status) return null
  git(root, ['commit', ...messageArgs(message, kind)], author)
  return git(root, ['rev-parse', 'HEAD']).trim()
}

export function commitPath(root: string, relativePath: string, message: string, author: GitAuthor, kind?: CommitKind): string | null {
  const normalized = relativePath.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('That hint is not a content field.')
  }
  git(root, ['add', '--', normalized])
  const status = git(root, ['status', '--porcelain', '--', normalized]).trim()
  if (!status) return null
  git(root, ['commit', ...messageArgs(message, kind), '--', normalized], author)
  return git(root, ['rev-parse', 'HEAD']).trim()
}

export function commitFiles(root: string, revision: string): string[] {
  return lines(git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', revision]))
}

export function filesChangedSince(root: string, revision: string): string[] {
  return lines(git(root, ['diff', '--name-only', '--no-renames', revision, 'draft']))
}

export function undoRevision(root: string, revision: string, author: GitAuthor): void {
  git(root, ['checkout', '-q', 'draft'])
  try {
    git(root, ['revert', '--no-edit', revision], author)
  } catch (error) {
    try {
      git(root, ['revert', '--abort'])
    } catch {
      // Revert never started, so there is nothing to abort.
    }
    throw error
  }
}

export function revertDraftToPublic(root: string): void {
  git(root, ['checkout', '-q', 'draft'])
  git(root, ['reset', '--hard', 'main'])
}

export function revisionsMatch(root: string): boolean {
  return git(root, ['rev-parse', 'draft']).trim() === git(root, ['rev-parse', 'main']).trim()
}

export function isAncestor(root: string, revision: string, branch = 'draft'): boolean {
  try {
    git(root, ['merge-base', '--is-ancestor', revision, branch])
    return true
  } catch {
    return false
  }
}

function lines(raw: string): string[] {
  return raw.split('\n').map((line) => line.trim()).filter(Boolean)
}

export function pointPublishedAtDraft(root: string): void {
  const draft = git(root, ['rev-parse', 'draft']).trim()
  git(root, ['update-ref', 'refs/heads/main', draft])
}

export function git(root: string, args: string[], author?: GitAuthor): string {
  const identity = author ? ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`] : []
  return execFileSync('git', ['-C', root, '-c', `safe.directory=${root}`, '-c', 'core.editor=true', ...identity, ...args], {
    encoding: 'utf8',
    // A failed check such as merge-base --is-ancestor is an answer, not something to print.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** The bytes of a file as it was at a revision. */
export function fileAt(root: string, revision: string, file: string): Buffer {
  return execFileSync('git', ['-C', root, '-c', `safe.directory=${root}`, 'show', `${revision}:${file}`], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** True when nothing in the working tree differs from the draft: no reply is writing files right now. */
export function worktreeClean(root: string): boolean {
  return git(root, ['status', '--porcelain']).trim() === ''
}

/** Make the working tree and the index match a revision, and stay on the draft, so the next commit is a restore. */
export function checkoutTree(root: string, revision: string): void {
  git(root, ['checkout', '-q', 'draft'])
  git(root, ['read-tree', '-u', '--reset', revision])
}

/** Put one file back to how a revision had it, or take it out when the revision did not have it. */
export function checkoutFile(root: string, revision: string, file: string): void {
  git(root, ['checkout', '-q', 'draft'])
  try {
    git(root, ['cat-file', '-e', `${revision}:${file}`])
  } catch {
    // Only the file goes; the commit that follows stages the removal.
    fs.rmSync(path.join(root, file), { force: true })
    return
  }
  git(root, ['checkout', revision, '--', file])
}
