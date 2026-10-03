import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { initSite } from '@schlor/generator'

export type GitAuthor = { name: string; email: string }

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

export function commitAll(root: string, message: string, author: GitAuthor): string | null {
  git(root, ['add', '-A'])
  const status = git(root, ['status', '--porcelain']).trim()
  if (!status) return null
  git(root, ['commit', '-m', message.slice(0, 200)], author)
  return git(root, ['rev-parse', 'HEAD']).trim()
}

export function commitPath(root: string, relativePath: string, message: string, author: GitAuthor): string | null {
  const normalized = relativePath.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('That hint is not a content field.')
  }
  git(root, ['add', '--', normalized])
  const status = git(root, ['status', '--porcelain', '--', normalized]).trim()
  if (!status) return null
  git(root, ['commit', '-m', message.slice(0, 200), '--', normalized], author)
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
  })
}
