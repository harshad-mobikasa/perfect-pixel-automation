import {
  inviteProjectMember,
  listProjectMembers,
  removeProjectMember,
  updateProjectMemberRole,
} from '../../../../../lib/account-store.js'
import { buildPasswordUrl, sendInviteEmail } from '../../../../../lib/mailer.js'
import { INVITE_TOKEN_TTL_SECONDS } from '../../../../../lib/password-token-store.js'
import { jsonError, jsonNoStore, requireUser } from '../../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BULK_INVITE_LIMIT = 25

export async function GET(_request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { projectId } = await params
  const members = await listProjectMembers(auth.user, projectId)
  if (!members) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  return jsonNoStore({ members })
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
    if (Array.isArray(body?.users)) {
      const rows = body.users.slice(0, BULK_INVITE_LIMIT)
      const results = []
      for (const row of rows) {
        results.push(await inviteProjectMemberAndSendEmail(auth.user, request, projectId, {
          email: row?.email,
          name: row?.name,
          role: body?.role,
        }))
      }
      return Response.json({ results }, { status: 207 })
    }

    const result = await inviteProjectMemberAndSendEmail(auth.user, request, projectId, {
      email: body?.email,
      name: body?.name,
      role: body?.role,
    })
    if (result.status === 'error') {
      return Response.json({ error: result.error }, { status: 400 })
    }
    return Response.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    return jsonError(error, error.message?.includes('cannot') ? 403 : 400)
  }
}

async function inviteProjectMemberAndSendEmail(actor, request, projectId, input) {
  try {
    const result = await inviteProjectMember(actor, projectId, input)
    const emailSent = await sendInviteIfNeeded(request, result)
    return {
      status: 'ok',
      user: result.user,
      created: result.created,
      emailSent,
    }
  } catch (error) {
    return {
      status: 'error',
      email: typeof input.email === 'string' ? input.email : '',
      error: error instanceof Error ? error.message : 'Invite failed',
    }
  }
}

async function sendInviteIfNeeded(request, result) {
  if (!result.inviteToken) return false
  const link = buildPasswordUrl(request, result.inviteToken.token)
  await sendInviteEmail({
    to: result.user.email,
    name: result.user.name,
    link,
    expiresInHours: Math.ceil(INVITE_TOKEN_TTL_SECONDS / 3600),
  })
  return true
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
