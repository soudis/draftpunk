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

export { renderContent, designFilePath, assertSlug, writeYaml, readYaml } from './content'
export { generate, pageOutputFile, replaceLayout, pageLayoutsOrThrow } from './generate'
export { lostContent } from './preservation'
export { applyContentCorrection } from './hints'
export {
  GENERATED_LAYOUTS,
  REQUIRED_LAYOUTS,
  checkLayout,
  forkLayout,
  formatCatalog,
  layoutCatalog,
  layoutExists,
  listLayoutNames,
  pageLayouts,
  parseLayoutFile,
  readLayout,
  readLayoutFiles,
  removeLayoutFolder,
  slotReferences,
  writeLayout,
} from './layouts'
export { bilingualGaps, checkPage, deletePage, listPageSlugs, pageFilePath, pageHasLanguage, pagesByLayout, readPage, writePage } from './pages'
export { applyProposal, readProposal, recordProposal } from './setup'
export { readLabels, readSiteConfig, setupAccepted, readEventFields } from './model'
export { SLOT_TYPES, parseSlotSchema, resolveSlots, serializeSlotSchema, slotSignature, slotTexts, validateSlots } from './slots'
export type { Lang, EventDoc, PlaceDoc } from './content'
export type { CatalogEntry, LayoutCheck, LayoutDef, LayoutFiles } from './layouts'
export type { PageFile } from './pages'
export type { SetupProposal } from './setup'
export type { SlotDef, SlotSchema } from './slots'
