import { cookies } from 'next/headers'
import { bilingualGaps, readSiteConfig, setupAccepted } from '@schlor/generator'
import { currentModelSettings } from '@/lib/model-settings'
import { openSession } from '@/lib/session'
import { siteRoot } from '@/lib/site'
import { ChatPanel } from './chat'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: readSiteConfig(siteRoot()).name }
}

export default async function EditPage() {
  const root = siteRoot()
  const gaps = bilingualGaps(root)
  const site = readSiteConfig(root)
  const token = (await cookies()).get('schlor_editor')?.value
  const session = await openSession(token)
  return (
    <ChatPanel
      siteName={site.name}
      accountName={session?.name ?? 'Editor'}
      accountPicture={session?.picture}
      gapCount={gaps.length}
      gapSample={gaps.slice(0, 6)}
      publishEnabled={process.env.WEBSITE_ALLOW_PUBLISH === '1'}
      setupOpen={!setupAccepted(root)}
      tokenSet={currentModelSettings().apiKey.length > 0}
    />
  )
}
