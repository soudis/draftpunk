import * as client from 'openid-client'

let configuration: Promise<client.Configuration> | undefined

export function oidcEnabled(): boolean {
  return Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET)
}

export async function oidcConfiguration(): Promise<client.Configuration> {
  const issuer = process.env.OIDC_ISSUER
  const clientId = process.env.OIDC_CLIENT_ID
  const clientSecret = process.env.OIDC_CLIENT_SECRET
  if (!issuer || !clientId || !clientSecret) throw new Error('OIDC is not configured')
  configuration ??= client.discovery(new URL(issuer), clientId, clientSecret, client.ClientSecretBasic(clientSecret))
  return configuration
}

export function redirectUri(): string {
  const uri = process.env.OIDC_REDIRECT_URI
  if (!uri) throw new Error('OIDC_REDIRECT_URI is required')
  return uri
}
