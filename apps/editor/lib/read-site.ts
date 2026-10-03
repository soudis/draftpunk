import { readWebsite } from './read-website'

export async function readSite(input: string): Promise<string> {
  const home = await readWebsite(input)
  const base = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
  const hrefs = [...home.matchAll(/→\s+(\S+)/g)]
    .map((match) => {
      try {
        return new URL(match[1] ?? '', base)
      } catch {
        return null
      }
    })
    .filter((url): url is URL => Boolean(url))
    .filter((url) => url.origin === base.origin && url.pathname !== base.pathname)
    .filter((url) => !/\.(pdf|jpe?g|png|gif|webp|svg|zip|ics)$/i.test(url.pathname))
  const seen = new Set<string>()
  const pages = [home]
  for (const url of hrefs) {
    if (seen.has(url.href) || seen.size >= 6) continue
    seen.add(url.href)
    try {
      pages.push(await readWebsite(url.href))
    } catch {
      continue
    }
  }
  return pages.join('\n\n----\n\n')
}
