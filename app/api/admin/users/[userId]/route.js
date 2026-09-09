import { removeUser, updateUser } from '../../../../../lib/account-store.js'
import { jsonError, requireAdmin } from '../../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { userId } = await params
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const user = await updateUser(auth.user, userId, {
      name: body?.name,
      role: body?.role,
      projectIds: body?.projectIds,
      password: body?.password,
    })

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }

    return Response.json({ user })
  } catch (error) {
    return jsonError(error, error.message?.includes('Only admins') ? 403 : 400)
  }
}

export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { userId } = await params

  try {
    const deleted = await removeUser(auth.user, userId)
    if (!deleted) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error, 400)
  }
}
