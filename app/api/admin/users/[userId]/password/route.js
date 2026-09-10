import { assignGeneratedPassword } from '../../../../../../lib/account-store.js'
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
    return Response.json(result)
  } catch (error) {
    return jsonError(error, 403)
  }
}
