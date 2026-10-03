import { bilingualGaps, generate } from '@schlor/generator'
import { commitAll, git, pointPublishedAtDraft, type GitAuthor } from './git'
import { publishedDir } from './site'

export function publishSite(root: string, author: GitAuthor, message: string): { revision: string } {
  if (process.env.WEBSITE_ALLOW_PUBLISH !== '1') {
    throw new Error('Publish stays off until the public host is switched on.')
  }
  const gaps = bilingualGaps(root)
  if (gaps.length > 0) {
    throw new Error(`Required languages are missing before publish. Missing: ${gaps.slice(0, 8).join(', ')}`)
  }
  commitAll(root, message, author)
  pointPublishedAtDraft(root)
  generate(root, publishedDir(root), { hints: false })
  return { revision: git(root, ['rev-parse', 'main']).trim() }
}
