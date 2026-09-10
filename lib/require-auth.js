import { cookies } from 'next/headers'
import { COOKIE_NAME, readSessionToken } from './session.js'
import { ensureBootstrapAdmin, publicUserById } from './account-store.js'
import { canManageUsers, isAdmin } from './roles.js'

async function getSessionUser() {
  await ensureBootstrapAdmin().catch((error) => {
    if (error?.code !== 'SETUP_REQUIRED') throw error
  })

  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  const session = await readSessionToken(token)
  if (!session?.userId) return null

  return publicUserById(session.userId)
}

async function requireUser() {
  const user = await getSessionUser()
  if (!user) {
    return {
      error: Response.json({ error: 'Sign in required' }, { status: 401 }),
    }
  }

  return { user }
}

async function requireAdmin() {
  const result = await requireUser()
  if (result.error) return result
  if (!isAdmin(result.user)) {
    return {
      error: Response.json({ error: 'Admin access required' }, { status: 403 }),
    }
  }

  return result
}

async function requireUserManager() {
  const result = await requireUser()
  if (result.error) return result
  if (!canManageUsers(result.user)) {
    return {
      error: Response.json({ error: 'You cannot manage users' }, { status: 403 }),
    }
  }

  return result
}

function jsonError(error, fallbackStatus = 400) {
  const status = error?.code === 'SETUP_REQUIRED' ? 503 : fallbackStatus
  return Response.json(
    { error: error instanceof Error ? error.message : 'Request failed' },
    { status },
  )
}

export { getSessionUser, jsonError, requireAdmin, requireUser, requireUserManager }
