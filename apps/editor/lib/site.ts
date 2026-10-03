import fs from 'node:fs'
import path from 'node:path'
import { generate, initSite } from '@schlor/generator'
import { ensureGit } from './git'

export function siteRoot(): string {
  const root = path.resolve(process.env.SITE_ROOT ?? path.join(process.cwd(), '../../instances/schlor'))
  if (!fs.existsSync(path.join(root, 'design', 'shell.njk'))) initSite(root)
  ensureGit(root)
  const dist = path.join(root, 'dist', 'index.html')
  if (!fs.existsSync(dist)) generate(root)
  return root
}

export function previewDir(root = siteRoot()): string {
  return path.join(root, 'dist')
}

export function publishedDir(root = siteRoot()): string {
  return path.join(root, 'published')
}

export function chatDatabasePath(): string {
  return path.resolve(process.env.CHAT_DB ?? path.join(siteRoot(), '..', 'schlor-data', 'chat.sqlite'))
}
