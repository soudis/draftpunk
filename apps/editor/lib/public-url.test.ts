import assert from 'node:assert/strict'
import test from 'node:test'
import { appUrl, oidcCallbackUrl } from './public-url'

const headers = (values: Record<string, string>) => ({
  get(name: string) {
    return values[name.toLowerCase()] ?? null
  },
})

test('links stay on the public host when Next is bound to every interface', () => {
  const request = {
    url: 'https://0.0.0.0:3000/auth/callback?code=abc&state=xyz',
    headers: headers({ host: 'schlor.site.habidat.localhost', 'x-forwarded-proto': 'https' }),
  }
  assert.equal(appUrl(request, '/edit').href, 'https://schlor.site.habidat.localhost/edit')
  process.env.OIDC_REDIRECT_URI = 'https://schlor.site.habidat.localhost/auth/callback'
  assert.equal(oidcCallbackUrl(request).href, 'https://schlor.site.habidat.localhost/auth/callback?code=abc&state=xyz')
  delete process.env.OIDC_REDIRECT_URI
})
