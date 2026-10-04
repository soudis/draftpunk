import { NextResponse, type NextRequest } from 'next/server'
import { appUrl } from '@/lib/public-url'
import { openSession } from '@/lib/session'
import { siteDecision } from '@/lib/site-route'

export async function middleware(request: NextRequest) {
  const session = await openSession(request.cookies.get('schlor_editor')?.value)
  const decision = siteDecision(request.nextUrl.pathname, Boolean(session))
  if (decision.type === 'next') return NextResponse.next()
  if (decision.type === 'login') return NextResponse.redirect(appUrl(request, '/auth/login'))
  const rewrite = request.nextUrl.clone()
  rewrite.pathname = decision.pathname
  return NextResponse.rewrite(rewrite)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
