const COOKIE_NAME = 'mobikasa_audit_session'
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET?.trim()
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required')
  }
  return 'mobikasa-audit-dev-secret'
}

function bytesToBase64Url(bytes) {
  let binary = ''
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  for (let index = 0; index < array.length; index += 1) {
    binary += String.fromCharCode(array[index])
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function textToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

function base64UrlToText(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

async function signValue(value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getAuthSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return bytesToBase64Url(signature)
}

async function createSessionToken(user) {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }
  const encoded = textToBase64Url(JSON.stringify(payload))
  const signature = await signValue(encoded)
  return `${encoded}.${signature}`
}

async function readSessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) return null

  const expected = await signValue(encoded)
  if (expected.length !== signature.length) return null

  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
  }
  if (mismatch !== 0) return null

  try {
    const payload = JSON.parse(base64UrlToText(encoded))
    if (!payload?.userId || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  }
}

export {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionToken,
  getSessionCookieOptions,
  readSessionToken,
}
