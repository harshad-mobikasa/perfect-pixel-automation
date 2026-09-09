import { cookies } from 'next/headers'
import { createSessionToken, COOKIE_NAME, getSessionCookieOptions } from '../../../../lib/session.js'
import { ensureBootstrapAdmin, getAccountStore, publicUser } from '../../../../lib/account-store.js'
import { verifyPassword } from '../../../../lib/password.js'
import { normalizeEmail } from '../../../../lib/account-validation.js'
import { jsonError } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOGIN_LIMIT = 8
const LOGIN_WINDOW_MS = 15 * 60 * 1000

const loginAttempts = globalThis.__auditLoginAttempts ?? new Map()
globalThis.__auditLoginAttempts = loginAttempts

function clientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

function checkLoginRateLimit(ip) {
  const now = Date.now()
  const timestamps = (loginAttempts.get(ip) ?? []).filter((time) => now - time < LOGIN_WINDOW_MS)
  if (timestamps.length >= LOGIN_LIMIT) {
    throw new Error('Too many sign-in attempts. Try again in a few minutes.')
  }
  timestamps.push(now)
  loginAttempts.set(ip, timestamps)
}

export async function POST(request) {
  try {
    checkLoginRateLimit(clientIp(request))
  } catch (error) {
    return Response.json({ error: error.message }, { status: 429 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    await ensureBootstrapAdmin()
    const email = normalizeEmail(body?.email)
    const password = typeof body?.password === 'string' ? body.password : ''
    const store = getAccountStore()
    const user = await store.getUserByEmail(email)
    const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false

    if (!user || !passwordOk) {
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const token = await createSessionToken(user)
    const cookieStore = await cookies()
    cookieStore.set(COOKIE_NAME, token, getSessionCookieOptions())

    return Response.json({ user: publicUser(user) })
  } catch (error) {
    return jsonError(error, error?.code === 'SETUP_REQUIRED' ? 503 : 400)
  }
}
