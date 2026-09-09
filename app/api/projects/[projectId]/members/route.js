import {
  inviteProjectMember,
  listProjectMembers,
  removeProjectMember,
  updateProjectMemberRole,
} from '../../../../../lib/account-store.js'
import { jsonError, requireUser } from '../../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { projectId } = await params
  const members = await listProjectMembers(auth.user, projectId)
  if (!members) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  return Response.json({ members })
}

export async function POST(request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { projectId } = await params
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const result = await inviteProjectMember(auth.user, projectId, {
      email: body?.email,
      name: body?.name,
      password: body?.password,
      role: body?.role,
    })
    return Response.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    return jsonError(error, error.message?.includes('cannot') ? 403 : 400)
  }
}

export async function PATCH(request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { projectId } = await params
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const user = await updateProjectMemberRole(auth.user, projectId, body?.userId, body?.role)
    return Response.json({ user })
  } catch (error) {
    return jsonError(error, error.message?.includes('cannot') ? 403 : 400)
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { projectId } = await params
  const userId = new URL(request.url).searchParams.get('userId')
  if (!userId) {
    return Response.json({ error: 'userId is required' }, { status: 400 })
  }

  try {
    const removed = await removeProjectMember(auth.user, projectId, userId)
    if (!removed) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error, error.message?.includes('cannot') ? 403 : 400)
  }
}
