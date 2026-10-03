type RequestLike = { url: string; headers: { get(name: string): string | null } }

export function appUrl(request: RequestLike, path: string): URL {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host') || ''
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const base = host && proto && !host.startsWith('0.0.0.0') ? `${proto}://${host}` : new URL(request.url).origin
  return new URL(path, base.endsWith('/') ? base : `${base}/`)
}

export function oidcCallbackUrl(request: RequestLike): URL {
  const configured = process.env.OIDC_REDIRECT_URI
  if (!configured) return new URL(request.url)
  const callback = new URL(configured)
  callback.search = new URL(request.url).search
  return callback
}
