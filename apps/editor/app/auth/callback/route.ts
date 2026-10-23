import { NextResponse, type NextRequest } from 'next/server'
import * as client from 'openid-client'
import { oidcConfiguration } from '@/lib/oidc'
import { appUrl, oidcCallbackUrl } from '@/lib/public-url'
import { httpsPicture, identityFrom, sealSession } from '@/lib/session'

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
  // Some providers keep the profile out of the ID token and give it only at the userinfo endpoint.
  const userinfo = await profileFrom(config, tokens.access_token, claims.sub)
  const picture = httpsPicture(claims.picture ?? userinfo.picture)
  const token = await sealSession({
    sub: claims.sub,
    ...identityFrom(claims.sub, claims, userinfo),
    exp: Date.now() + 12 * 60 * 60 * 1000,
    ...(picture ? { picture } : {}),
  })
  const response = NextResponse.redirect(appUrl(request, '/edit'))
  response.cookies.set('schlor_editor', token, sessionCookie())
  response.cookies.set('schlor_oidc', '', { path: '/auth', maxAge: 0 })
  return response
}

async function profileFrom(config: client.Configuration, accessToken: string, sub: string) {
  try {
    return await client.fetchUserInfo(config, accessToken, sub)
  } catch (error) {
    // The login still works with what the ID token had.
    console.error(error)
    return {} as Record<string, unknown>
  }
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
