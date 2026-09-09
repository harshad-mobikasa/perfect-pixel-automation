import { createInvitedUser, listVisibleUsers } from '../../../../lib/account-store.js'
import { jsonError, requireUserManager } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireUserManager()
  if (auth.error) return auth.error

  try {
    const users = await listVisibleUsers(auth.user)
    return Response.json({ users })
  } catch (error) {
    return jsonError(error, 500)
  }
}

export async function POST(request) {
  const auth = await requireUserManager()
  if (auth.error) return auth.error

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const user = await createInvitedUser(auth.user, {
      email: body?.email,
      password: body?.password,
      name: body?.name,
      role: body?.role,
      projectIds: body?.projectIds,
    })
    return Response.json({ user }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
