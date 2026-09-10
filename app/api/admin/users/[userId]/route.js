import { removeUser, updateUser } from '../../../../../lib/account-store.js'
import { jsonError, requireUserManager } from '../../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  const auth = await requireUserManager()
  if (auth.error) return auth.error

  const { userId } = await params
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const patch = {}
    if (typeof body?.name === 'string') patch.name = body.name
    if (body?.role != null) patch.role = body.role
    if (Array.isArray(body?.projectIds)) patch.projectIds = body.projectIds
    if (typeof body?.password === 'string' && body.password) patch.password = body.password

    const user = await updateUser(auth.user, userId, patch)

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }

    return Response.json({ user })
  } catch (error) {
    return jsonError(error, error.message?.includes('Only admins') || error.message?.includes('cannot') ? 403 : 400)
  }
}

export async function DELETE(_request, { params }) {
  const auth = await requireUserManager()
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
