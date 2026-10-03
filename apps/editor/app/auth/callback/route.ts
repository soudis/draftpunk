import { NextResponse, type NextRequest } from 'next/server'
import * as client from 'openid-client'
import { oidcConfiguration } from '@/lib/oidc'
import { appUrl, oidcCallbackUrl } from '@/lib/public-url'
import { httpsPicture, sealSession } from '@/lib/session'

export async function GET(request: NextRequest) {
  const stored = request.cookies.get('schlor_oidc')?.value
  if (!stored) return NextResponse.redirect(appUrl(request, '/auth/login'))
  const { state, nonce } = JSON.parse(stored) as { state: string; nonce: string }
  const config = await oidcConfiguration()
  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>
  try {
    tokens = await client.authorizationCodeGrant(config, oidcCallbackUrl(request), {
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    })
  } catch (error) {
    console.error(error)
    return NextResponse.redirect(appUrl(request, '/auth/login'))
  }
  const claims = tokens.claims()
  if (!claims?.sub) return NextResponse.json({ error: 'Login did not return a subject' }, { status: 400 })
  const picture = httpsPicture(claims.picture)
  const token = await sealSession({
    sub: claims.sub,
    name: String(claims.name ?? claims.preferred_username ?? claims.email ?? 'Editor'),
    email: String(claims.email ?? `${claims.sub}@schlor.local`),
    exp: Date.now() + 12 * 60 * 60 * 1000,
    ...(picture ? { picture } : {}),
  })
  const response = NextResponse.redirect(appUrl(request, '/edit'))
  response.cookies.set('schlor_editor', token, sessionCookie())
  response.cookies.set('schlor_oidc', '', { path: '/auth', maxAge: 0 })
  return response
}

function sessionCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 12 * 60 * 60,
    secure: process.env.NODE_ENV === 'production',
  }
}
