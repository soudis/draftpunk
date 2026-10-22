import { pagesByLayout, pageUrl, readSiteConfig, slotExpectations } from '@schlor/generator'
import { browserConfigured } from './browser'
import { auditPage, type ViewportName } from './page-audit'

/** Remembers what was already reported in this request, so the same problem is not told twice. */
export type Verifier = { seen: Set<string> }

export function createVerifier(): Verifier {
  return { seen: new Set() }
}

const GENERATED_PATH: Record<string, string> = { calendar: '/kalender/', archive: '/blog/' }
const MAX_PAGES = 4

/** The pages that show a design change: those that use the layout, or one page per layout when the change is global. */
export function pagesToCheck(root: string, layout?: string): string[] {
  const site = readSiteConfig(root)
  const lang = site.languages[0]?.id ?? 'de'
  const url = (slug: string) => pageUrl(slug, lang, site)
  if (layout) {
    if (GENERATED_PATH[layout]) return [GENERATED_PATH[layout]]
    if (layout === 'event') return []
    return (pagesByLayout(root).get(layout) ?? []).slice(0, 2).map(url)
  }
  const paths = new Set<string>(['/'])
  for (const slugs of pagesByLayout(root).values()) {
    if (slugs[0]) paths.add(url(slugs[0]))
    if (paths.size >= MAX_PAGES) break
  }
  return [...paths]
}

/**
 * After a design change: look at the changed pages in a browser and say what is wrong, once. Does nothing
 * without a browser, and a failing browser never fails the change.
 */
export async function verifyDesign(root: string, verifier: Verifier, layout?: string): Promise<string> {
  if (!browserConfigured()) return ''
  const paths = pagesToCheck(root, layout)
  if (paths.length === 0) return ''
  try {
    const expectations = slotExpectations(root)
    const views: ViewportName[] = ['mobile', 'desktop']
    const audits = await Promise.all(paths.flatMap((path) => views.map((view) => auditPage(root, path, view, { expectations }))))
    const fresh: string[] = []
    for (const audit of audits) {
      for (const finding of audit.findings) {
        const key = `${audit.path}|${audit.viewport}|${finding}`
        if (verifier.seen.has(key)) continue
        verifier.seen.add(key)
        fresh.push(`${audit.path} (${audit.viewport}): ${finding}`)
      }
    }
    if (fresh.length === 0) return `Checked ${paths.join(', ')} in a browser at phone and desktop width: nothing new is wrong.`
    return `Checked in a browser:\n- ${fresh.join('\n- ')}\nFix these before you finish.`
  } catch (error) {
    return `(The browser check did not run: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}.)`
  }
}
