import { NextResponse, type NextRequest } from 'next/server'
import { appUrl } from '@/lib/public-url'

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(appUrl(request, '/auth/login'))
  response.cookies.set('schlor_editor', '', { path: '/', maxAge: 0 })
  return response
}
