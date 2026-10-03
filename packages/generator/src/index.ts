import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed')

export function seedDirectory(): string {
  return seedDir
}

export function initSite(root: string): void {
  fs.mkdirSync(root, { recursive: true })
  fs.cpSync(path.join(seedDir, 'design'), path.join(root, 'design'), { recursive: true })
  fs.cpSync(path.join(seedDir, 'content'), path.join(root, 'content'), { recursive: true })
  const media = path.join(root, 'media')
  fs.mkdirSync(media, { recursive: true })
  const seedMedia = path.join(seedDir, 'media')
  if (fs.existsSync(seedMedia)) fs.cpSync(seedMedia, media, { recursive: true })
}

export { bilingualGaps, renderContent, designFilePath, contentPagePath, assertSlug, listPageSlugs, writePageFile, writeYaml, readYaml, readPageFile } from './content'
export { generate, replaceLayout, pageLayoutsOrThrow } from './generate'
export { applyContentCorrection } from './hints'
export { applyProposal, readProposal, recordProposal } from './setup'
export { readSiteConfig, setupAccepted, readEventFields, SECTION_SHAPES } from './model'
export type { Lang, PageDoc, EventDoc, PlaceDoc } from './content'
export type { SetupProposal } from './setup'
