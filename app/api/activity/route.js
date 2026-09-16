import { listActivity } from '../../../lib/activity-log.js'
import { jsonError, requireUserManager } from '../../../lib/require-auth.js'
import { actorManagedProjectIds } from '../../../lib/roles.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const auth = await requireUserManager()
  if (auth.error) return auth.error

  const url = new URL(request.url)

  try {
    const result = await listActivity(auth.user, actorManagedProjectIds(auth.user), {
      from: url.searchParams.get('from') ?? '',
      to: url.searchParams.get('to') ?? '',
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    })
    return Response.json(result)
  } catch (error) {
    return jsonError(error, 500)
  }
}
