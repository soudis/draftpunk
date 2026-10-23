/** Structured data for search engines (schema.org), a feed of the posts, and the picture a page is shared with. */
export type Json = Record<string, unknown>

const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export function organizationLd(input: { name: string; url: string; logo?: string }): Json {
  return { '@context': 'https://schema.org', '@type': 'Organization', name: input.name, url: input.url, ...(input.logo ? { logo: input.logo } : {}) }
}

/** The site, with its search so that a search engine can offer it in its own results. */
export function websiteLd(input: { name: string; url: string; lang: string; searchTarget?: string }): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: input.name,
    url: input.url,
    inLanguage: input.lang,
    ...(input.searchTarget ? { potentialAction: { '@type': 'SearchAction', target: input.searchTarget, 'query-input': 'required name=search_term_string' } } : {}),
  }
}

export function postLd(input: { headline: string; url: string; date: string; lang: string; description?: string; publisher: { name: string; logo?: string } }): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: input.headline.slice(0, 110),
    mainEntityOfPage: input.url,
    datePublished: input.date,
    dateModified: input.date,
    inLanguage: input.lang,
    ...(input.description ? { description: input.description } : {}),
    author: { '@type': 'Organization', name: input.publisher.name },
    publisher: { '@type': 'Organization', name: input.publisher.name, ...(input.publisher.logo ? { logo: { '@type': 'ImageObject', url: input.publisher.logo } } : {}) },
  }
}

/** The way down to a page, as search engines show it above a result: the home page, its menu parent or the news, and the page. */
export function breadcrumbLd(trail: { name: string; url: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, index) => ({ '@type': 'ListItem', position: index + 1, name: step.name, item: step.url })),
  }
}

/** One Event for each date of an event: a series is several events of one name, which is how search engines list them. */
export function eventLds(input: {
  name: string
  url: string
  lang: string
  description?: string
  dates: { start: string; end?: string }[]
  place?: { name?: string; address?: string }
}): Json[] {
  return input.dates
    .filter((date) => !Number.isNaN(new Date(date.start).getTime()))
    .map((date) => ({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: input.name,
      url: input.url,
      inLanguage: input.lang,
      startDate: date.start,
      ...(date.end && !Number.isNaN(new Date(date.end).getTime()) ? { endDate: date.end } : {}),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      ...(input.description ? { description: input.description } : {}),
      ...(input.place?.name || input.place?.address
        ? {
            location: {
              '@type': 'Place',
              ...(input.place.name ? { name: input.place.name } : {}),
              ...(input.place.address ? { address: input.place.address } : {}),
            },
          }
        : {}),
    }))
}

/** A script tag for the data. A < in it is written as \u003c, so no text in it can end the tag. */
export function jsonLdTag(items: Json[]): string {
  const data = items.length === 1 ? items[0] : items
  return `<script type="application/ld+json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`
}

/** The picture a page is shared with: the first one in its main part that is large enough and not see-through, as a path in the site. */
export function firstMainImage(html: string): string | undefined {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? ''
  for (const tag of main.matchAll(/<img\b[^>]*>/gi)) {
    const src = /\ssrc\s*=\s*["'](\/media\/[^"'?#]+)["']/i.exec(tag[0])?.[1]
    if (!src || /\sdata-transparent\b/i.test(tag[0])) continue
    const width = Number(/\swidth\s*=\s*["'](\d+)["']/i.exec(tag[0])?.[1] ?? 0)
    if (width > 0 && width < 300) continue
    if (/\.(?:svg|gif)$/i.test(src)) continue
    return src
  }
  return undefined
}

export type FeedEntry = { title: string; url: string; date: string; summary: string }

/** An Atom feed of the posts, newest first. */
export function atomFeed(input: { title: string; homeUrl: string; selfUrl: string; lang: string; author: string; entries: FeedEntry[] }): string {
  const stamp = (date: string) => `${date.slice(0, 10)}T00:00:00Z`
  const entries = [...input.entries].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 50)
  const updated = entries[0] ? stamp(entries[0].date) : new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const items = entries
    .map(
      (entry) =>
        `  <entry>\n    <title>${escapeXml(entry.title)}</title>\n    <link href="${escapeXml(entry.url)}"/>\n    <id>${escapeXml(entry.url)}</id>\n    <updated>${stamp(entry.date)}</updated>\n    <summary>${escapeXml(entry.summary)}</summary>\n  </entry>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${escapeXml(input.lang)}">\n  <title>${escapeXml(input.title)}</title>\n  <link href="${escapeXml(input.homeUrl)}"/>\n  <link rel="self" type="application/atom+xml" href="${escapeXml(input.selfUrl)}"/>\n  <id>${escapeXml(input.selfUrl)}</id>\n  <updated>${updated}</updated>\n  <author><name>${escapeXml(input.author)}</name></author>\n${items}\n</feed>\n`
}
