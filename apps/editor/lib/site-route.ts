export type SiteDecision = { type: 'next' } | { type: 'login' } | { type: 'rewrite'; pathname: string }

export function siteDecision(pathname: string, loggedIn: boolean): SiteDecision {
  if (pathname.startsWith('/auth') || pathname.startsWith('/_next') || pathname === '/favicon.ico') return { type: 'next' }
  const preview = pathname === '/preview' || pathname.startsWith('/preview/')
  const publicFiles = pathname.startsWith('/api/site')
  const gated = pathname.startsWith('/edit') || preview || (pathname.startsWith('/api') && !publicFiles)
  if (gated && !loggedIn) return { type: 'login' }
  if (pathname.startsWith('/edit') || pathname.startsWith('/api')) return { type: 'next' }
  if (preview) return { type: 'rewrite', pathname: `/api/preview${indexPath(pathname.slice('/preview'.length) || '/')}` }
  return { type: 'rewrite', pathname: `/api/site${indexPath(pathname)}` }
}

export function toPreviewPath(pathname: string): string {
  if (pathname === '/preview' || pathname.startsWith('/preview/')) return pathname
  if (pathname === '/') return '/preview/'
  return `/preview${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

export function rewritePreviewUrls(text: string): string {
  const withAttributes = text.replace(/(\s[\w:-]+\s*=\s*)(["'])([\s\S]*?)\2/g, (_full, before: string, quote: string, value: string) => {
    return `${before}${quote}${rewriteAttributeValue(value)}${quote}`
  })
  return withAttributes.replace(/url\(\s*(["']?)\/(?!\/|preview\/)/gi, 'url($1/preview/').replace(/@import\s+(["'])\/(?!\/|preview\/)/gi, '@import $1/preview/')
}

function rewriteAttributeValue(value: string): string {
  return value.replace(/(^|[\s,])\/(?!\/|preview\/)(?=\S|$)/g, '$1/preview/')
}

function indexPath(pathname: string): string {
  if (pathname === '/' || pathname === '') return '/index.html'
  return pathname.endsWith('/') ? `${pathname}index.html` : pathname
}
