import { normalizeEmail } from '../../../../lib/account-validation.js'
import { jsonError } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FORGOT_LIMIT = 5
const FORGOT_WINDOW_MS = 15 * 60 * 1000

const forgotAttempts = globalThis.__auditForgotAttempts ?? new Map()
globalThis.__auditForgotAttempts = forgotAttempts

function clientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

function checkForgotRateLimit(ip) {
  const current = Date.now()
  const timestamps = (forgotAttempts.get(ip) ?? []).filter((time) => current - time < FORGOT_WINDOW_MS)
  if (timestamps.length >= FORGOT_LIMIT) {
    throw new Error('Too many reset requests. Try again in a few minutes.')
  }
  timestamps.push(current)
  forgotAttempts.set(ip, timestamps)
}

export async function POST(request) {
  try {
    checkForgotRateLimit(clientIp(request))
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
    normalizeEmail(body?.email)
  } catch (error) {
    return jsonError(error)
  }

  return Response.json({
    ok: true,
    message:
      'If that account exists, ask an Admin or Project admin to send you a reset link from Manage users.',
  })
}
