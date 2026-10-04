import { publishedDir } from '@/lib/site'
import { serveGenerated } from '@/lib/site-serve'

export async function GET(_request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const { path: parts = [] } = await context.params
  return serveGenerated(publishedDir(), parts.join('/'), false)
}
