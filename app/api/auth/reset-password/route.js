import { asPassword } from '../../../../lib/password.js'
import { consumeResetToken } from '../../../../lib/password-reset.js'
import { setUserPasswordById } from '../../../../lib/account-store.js'
import { jsonError } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESET_LIMIT = 8
const RESET_WINDOW_MS = 15 * 60 * 1000

const resetAttempts = globalThis.__auditResetAttempts ?? new Map()
globalThis.__auditResetAttempts = resetAttempts

function clientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

function checkResetRateLimit(ip) {
  const current = Date.now()
  const timestamps = (resetAttempts.get(ip) ?? []).filter((time) => current - time < RESET_WINDOW_MS)
  if (timestamps.length >= RESET_LIMIT) {
    throw new Error('Too many reset attempts. Try again in a few minutes.')
  }
  timestamps.push(current)
  resetAttempts.set(ip, timestamps)
}

export async function POST(request) {
  try {
    checkResetRateLimit(clientIp(request))
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
    asPassword(body?.password)
    if (body?.password !== body?.confirmPassword) {
      throw new Error('Passwords do not match')
    }

    const userId = await consumeResetToken(typeof body?.token === 'string' ? body.token : '')
    if (!userId) {
      return Response.json({ error: 'This reset link is invalid or has expired' }, { status: 400 })
    }

    const updated = await setUserPasswordById(userId, body.password)
    if (!updated) {
      return Response.json({ error: 'This reset link is invalid or has expired' }, { status: 400 })
    }

    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
