export type EditorSession = {
  sub: string
  name: string
  email: string
  exp: number
  picture?: string
}

export function httpsPicture(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    return url.href
  } catch {
    return undefined
  }
}

const encoder = new TextEncoder()

export function sessionSecret(): string {
  const secret = process.env.EDITOR_SESSION_SECRET
  if (secret) return secret
  if (process.env.EDITOR_DEV_AUTH === '1' && process.env.NODE_ENV !== 'production') {
    return 'dev-only-editor-secret'
  }
  throw new Error('EDITOR_SESSION_SECRET is required')
}

export async function sealSession(session: EditorSession, secret = sessionSecret()): Promise<string> {
  const payload = base64Url(encoder.encode(JSON.stringify(session)))
  const sig = base64Url(new Uint8Array(await sign(payload, secret)))
  return `${payload}.${sig}`
}

export async function sessionFromRequest(request: Request, secret = sessionSecret()): Promise<EditorSession | null> {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)schlor_editor=([^;]+)/)?.[1]
  return openSession(token ? decodeURIComponent(token) : undefined, secret)
}

export async function openSession(token: string | undefined, secret = sessionSecret()): Promise<EditorSession | null> {
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = new Uint8Array(await sign(payload, secret))
  const actual = fromBase64Url(sig)
  if (expected.length !== actual.length) return null
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i]
  if (diff !== 0) return null
  const session = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as EditorSession
  if (!session.exp || session.exp < Date.now()) return null
  const picture = httpsPicture(session.picture)
  return picture ? { ...session, picture } : { sub: session.sub, name: session.name, email: session.email, exp: session.exp }
}

async function sign(payload: string, secret: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', key, encoder.encode(payload))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
