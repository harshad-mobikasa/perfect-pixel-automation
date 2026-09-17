import { createInvitedUser, listVisibleUsers } from '../../../../lib/account-store.js'
import { buildPasswordUrl, sendInviteEmail } from '../../../../lib/mailer.js'
import { INVITE_TOKEN_TTL_SECONDS } from '../../../../lib/password-token-store.js'
import { jsonError, jsonNoStore, requireUserManager } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BULK_INVITE_LIMIT = 25

export async function GET() {
  const auth = await requireUserManager()
  if (auth.error) return auth.error

  try {
    const users = await listVisibleUsers(auth.user)
    return jsonNoStore({ users })
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
    if (Array.isArray(body?.users)) {
      const rows = body.users.slice(0, BULK_INVITE_LIMIT)
      const results = []
      for (const row of rows) {
        results.push(await inviteUserAndSendEmail(auth.user, request, {
          email: row?.email,
          name: row?.name,
          role: body?.role,
          projectIds: body?.projectIds,
        }))
      }
      return Response.json({ results }, { status: 207 })
    }

    const result = await inviteUserAndSendEmail(auth.user, request, {
      email: body?.email,
      name: body?.name,
      role: body?.role,
      projectIds: body?.projectIds,
    })
    if (result.status === 'error') {
      return Response.json({ error: result.error }, { status: 400 })
    }
    return Response.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    return jsonError(error)
  }
}

async function inviteUserAndSendEmail(actor, request, input) {
  try {
    const result = await createInvitedUser(actor, input)
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
