import { updateOwnProfile } from '../../../../lib/account-store.js'
import { getSessionUser, jsonError, requireUser } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return Response.json({ error: 'Sign in required' }, { status: 401 })
  }

  return Response.json({ user })
}

export async function PATCH(request) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const user = await updateOwnProfile(auth.user, { name: body?.name })
    return Response.json({ user })
  } catch (error) {
    return jsonError(error, 400)
  }
}
