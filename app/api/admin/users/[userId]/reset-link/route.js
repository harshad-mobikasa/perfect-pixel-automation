import { createUserResetLink } from '../../../../../../lib/account-store.js'
import { jsonError, requireUserManager } from '../../../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function requestOrigin(request) {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const host = forwardedHost ?? request.headers.get('host')
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https'
  if (!host) {
    return new URL(request.url).origin
  }
  return `${protocol}://${host}`
}

export async function POST(request, { params }) {
  const auth = await requireUserManager()
  if (auth.error) return auth.error

  const { userId } = await params

  try {
    const resetUrl = await createUserResetLink(auth.user, userId, requestOrigin(request))
    if (!resetUrl) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }
    return Response.json({ resetUrl })
  } catch (error) {
    return jsonError(error, 403)
  }
}
