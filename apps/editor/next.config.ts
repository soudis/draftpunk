import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@schlor/generator'],
  serverExternalPackages: ['better-sqlite3'],
  agentRules: false,
}

export default nextConfig
