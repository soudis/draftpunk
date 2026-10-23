import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@schlor/generator'],
  serverExternalPackages: ['better-sqlite3', 'playwright-core'],
  agentRules: false,
  // The generated site has its own addresses, with a closing slash. The middleware answers them, not Next.
  skipTrailingSlashRedirect: true,
}

export default nextConfig
