import type { Metadata } from 'next'
import './editor.css'

export const metadata: Metadata = { title: 'schloR editor' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  )
}
