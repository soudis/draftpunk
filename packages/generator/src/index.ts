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
export { assetsCss, generate, pageOutputFile, pageUrl, replaceLayout, pageLayoutsOrThrow } from './generate'
export { checkSite } from './check-site'
export { sanitizeSvg } from './svg'
export type { SvgReport } from './svg'
export { upgradeAdvice, upgradeDesign } from './upgrade'
export { lostContent, slotExpectations } from './preservation'
export type { PageExpectation } from './preservation'
export { applyContentCorrection } from './hints'
export {
  GENERATED_LAYOUTS,
  REQUIRED_LAYOUTS,
  checkLayout,
  forkLayout,
  formatCatalog,
  labelReferences,
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
export { bilingualGaps, checkPage, deletePage, dropOtherLanguages, listPageSlugs, pageFilePath, pageHasLanguage, pagesByLayout, readPage, writePage } from './pages'
export { applyProposal, normalizeProposal, proposalProblems, readProposal, recordProposal } from './setup'
export { assetProblems, labelNames, parseLabels, readLabels, readSiteConfig, setupAccepted, readEventFields } from './model'
export { fontFaceCss, fontPreloadLinks, parseFonts, readFonts, writeFonts } from './fonts'
export type { FontFace } from './fonts'
export { SLOT_TYPES, parseSlotSchema, resolveSlots, serializeSlotSchema, slotSignature, slotTexts, validateSlots } from './slots'
export { contrastRatio, contrastWarnings, emptyTokens, nearestColor, parseTokens, readTokens, tokenSummary, tokensCss, writeTokens } from './tokens'
export type { Tokens } from './tokens'
export type { Lang, EventDoc, PlaceDoc } from './content'
export type { CatalogEntry, LayoutCheck, LayoutDef, LayoutFiles } from './layouts'
export type { PageFile } from './pages'
export type { SetupProposal } from './setup'
export type { SlotDef, SlotSchema } from './slots'
