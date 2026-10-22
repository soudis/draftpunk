import { applyProposal, generate, setupAccepted } from '@schlor/generator'
import { commitPath, type GitAuthor } from './git'

/** Keep the plain starter and call setup done, without a proposal. */
export function skipSetup(root: string, author: GitAuthor): { skipped: boolean } {
  if (setupAccepted(root)) return { skipped: false }
  applyProposal(root, {}, true)
  generate(root)
  commitPath(root, 'design/setup.yml', 'Start from the plain starter', author)
  return { skipped: true }
}
