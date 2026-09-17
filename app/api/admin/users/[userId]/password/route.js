import { assignGeneratedPassword } from '../../../../../../lib/account-store.js'
import { buildPasswordUrl, sendInviteEmail, sendPasswordResetEmail } from '../../../../../../lib/mailer.js'
import { INVITE_TOKEN_TTL_SECONDS, RESET_TOKEN_TTL_SECONDS, TOKEN_PURPOSE } from '../../../../../../lib/password-token-store.js'
import { jsonError, requireUserManager } from '../../../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_request, { params }) {
  const auth = await requireUserManager()
  if (auth.error) return auth.error

  const { userId } = await params

  try {
    const result = await assignGeneratedPassword(auth.user, userId)
    if (!result) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }
    const link = buildPasswordUrl(_request, result.resetToken.token)
    if (result.purpose === TOKEN_PURPOSE.INVITE) {
      await sendInviteEmail({
        to: result.user.email,
        name: result.user.name,
        link,
        expiresInHours: Math.ceil(INVITE_TOKEN_TTL_SECONDS / 3600),
      })
    } else {
      await sendPasswordResetEmail({
        to: result.user.email,
        name: result.user.name,
        link,
        expiresInHours: Math.ceil(RESET_TOKEN_TTL_SECONDS / 3600),
      })
    }
    return Response.json({ user: result.user, emailSent: true, purpose: result.purpose })
  } catch (error) {
    return jsonError(error, 403)
  }
}
