import { NextResponse, type NextRequest } from 'next/server'
import * as client from 'openid-client'
import { oidcConfiguration, oidcEnabled, redirectUri } from '@/lib/oidc'
import { appUrl } from '@/lib/public-url'

export async function GET(request: NextRequest) {
  if (!oidcEnabled()) {
    if (process.env.EDITOR_DEV_AUTH === '1') {
      return NextResponse.redirect(appUrl(request, '/auth/dev'))
    }
    return NextResponse.json({ error: 'OIDC is not configured' }, { status: 500 })
  }
  const config = await oidcConfiguration()
  const state = client.randomState()
  const nonce = client.randomNonce()
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(),
    scope: 'openid profile email',
    state,
    nonce,
  })
  const response = NextResponse.redirect(url)
  response.cookies.set('schlor_oidc', JSON.stringify({ state, nonce }), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/auth',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}
