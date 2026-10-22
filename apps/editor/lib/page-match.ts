// Which page the preview shows. Pure, so the browser side can use it.
export type PageEntry = {
  slug: string
  title: string
  /** The address of the page in each language, as the generator names it. */
  urls: Record<string, string>
}

function normal(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || '/'
  const bare = path === '/preview' ? '/' : path.startsWith('/preview/') ? path.slice('/preview'.length) : path
  const last = bare.split('/').pop() ?? ''
  const withSlash = bare.endsWith('/') || last.includes('.') ? bare : `${bare}/`
  return withSlash.replace(/\/index\.html$/, '/')
}

/** The page and language a preview address belongs to, or null for an address that is no page (the calendar, an event). */
export function pageForPath(entries: PageEntry[], pathname: string): { entry: PageEntry; lang: string } | null {
  const wanted = normal(pathname)
  for (const entry of entries) {
    for (const [lang, url] of Object.entries(entry.urls)) {
      if (normal(url) === wanted) return { entry, lang }
    }
  }
  return null
}

/** The preview address to open for a page, in the language that is shown now when the page has it. */
export function previewAddress(entry: PageEntry, lang: string | null): string {
  const url = (lang && entry.urls[lang]) || Object.values(entry.urls)[0] || '/'
  return `/preview${url.startsWith('/') ? url : `/${url}`}`
}
