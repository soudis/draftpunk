import { NextResponse, type NextRequest } from 'next/server'
import { appUrl } from '@/lib/public-url'
import { openSession } from '@/lib/session'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/auth') || pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next()
  }
  const session = await openSession(request.cookies.get('schlor_editor')?.value)
  if (!session) {
    return NextResponse.redirect(appUrl(request, '/auth/login'))
  }
  if (pathname.startsWith('/edit') || pathname.startsWith('/api')) return NextResponse.next()
  const rewrite = request.nextUrl.clone()
  const sitePath = pathname === '/' ? '/index.html' : pathname.endsWith('/') ? `${pathname}index.html` : pathname
  rewrite.pathname = `/api/site${sitePath}`
  return NextResponse.rewrite(rewrite)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
