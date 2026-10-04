import { NextResponse } from 'next/server'
import { openSession } from '@/lib/session'
import { previewDir } from '@/lib/site'
import { serveGenerated } from '@/lib/site-serve'

export async function GET(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const session = await openSession(request.headers.get('cookie')?.match(/(?:^|;\s*)schlor_editor=([^;]+)/)?.[1])
  if (!session) return NextResponse.json({ error: 'Login required' }, { status: 401 })
  const { path: parts = [] } = await context.params
  return serveGenerated(previewDir(), parts.join('/'), true)
}
