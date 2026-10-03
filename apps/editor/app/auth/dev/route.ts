import { NextResponse, type NextRequest } from 'next/server'
import { appUrl } from '@/lib/public-url'
import { sealSession } from '@/lib/session'

export async function GET(request: NextRequest) {
  if (process.env.EDITOR_DEV_AUTH !== '1' || process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Dev login is off' }, { status: 404 })
  }
  const token = await sealSession({
    sub: 'dev',
    name: 'Dev editor',
    email: 'dev@schlor.local',
    exp: Date.now() + 12 * 60 * 60 * 1000,
  })
  const response = NextResponse.redirect(appUrl(request, '/edit'))
  response.cookies.set('schlor_editor', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
  })
  return response
}
