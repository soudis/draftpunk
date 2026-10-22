import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@schlor/generator'],
  serverExternalPackages: ['better-sqlite3', 'playwright-core'],
  agentRules: false,
}

export default nextConfig
