import { createProject, listAccessibleProjects } from '../../../lib/account-store.js'
import { jsonError, requireAdmin, requireUser } from '../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireUser()
  if (auth.error) return auth.error

  try {
    const projects = await listAccessibleProjects(auth.user)
    return Response.json({ projects })
  } catch (error) {
    return jsonError(error, 500)
  }
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const project = await createProject(auth.user, {
      name: body?.name,
      memberIds: body?.memberIds,
      config: body?.config,
    })
    return Response.json({ project }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
