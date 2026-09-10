import { getAccountStore } from '../../../lib/account-store.js'
import { ACTIVITY_RETENTION_DAYS, listActivity } from '../../../lib/activity-log.js'
import { jsonError, requireUserManager } from '../../../lib/require-auth.js'
import { actorManagedProjectIds } from '../../../lib/roles.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireUserManager()
  if (auth.error) return auth.error

  try {
    const store = getAccountStore()
    const projects = await store.listProjects()
    const events = await listActivity(auth.user, actorManagedProjectIds(auth.user, projects))
    return Response.json({ events, retentionDays: ACTIVITY_RETENTION_DAYS })
  } catch (error) {
    return jsonError(error, 500)
  }
}
