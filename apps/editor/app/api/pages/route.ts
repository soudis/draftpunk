import { pageEntries } from '@/lib/page-list'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  try {
    return Response.json({ pages: pageEntries(siteRoot()) })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not list the pages' }, { status: 400 })
  }
}
