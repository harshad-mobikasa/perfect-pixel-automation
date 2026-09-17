import { buildPasswordUrl, sendPasswordResetEmail } from '../../../../lib/mailer.js'
import { RESET_TOKEN_TTL_SECONDS } from '../../../../lib/password-token-store.js'
import { requestPasswordReset } from '../../../../lib/account-store.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESET_LIMIT = 5
const RESET_WINDOW_MS = 15 * 60 * 1000
const resetAttempts = globalThis.__auditForgotPasswordAttempts ?? new Map()
globalThis.__auditForgotPasswordAttempts = resetAttempts

function clientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

function checkResetRateLimit(ip) {
  const now = Date.now()
  const timestamps = (resetAttempts.get(ip) ?? []).filter((time) => now - time < RESET_WINDOW_MS)
  if (timestamps.length >= RESET_LIMIT) {
    throw new Error('Too many reset requests. Try again in a few minutes.')
  }
  timestamps.push(now)
  resetAttempts.set(ip, timestamps)
}

function successResponse() {
  return Response.json({
    ok: true,
    message: 'If an account exists for this email, a reset link has been sent.',
  })
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

  const result = await requestPasswordReset(body?.email)
  if (!result) {
    return successResponse()
  }

  const link = buildPasswordUrl(request, result.resetToken.token)
  await sendPasswordResetEmail({
    to: result.user.email,
    name: result.user.name,
    link,
    expiresInHours: Math.ceil(RESET_TOKEN_TTL_SECONDS / 3600),
  })

  return successResponse()
}
