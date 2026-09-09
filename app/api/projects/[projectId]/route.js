import { canAccessProject, deleteProject, getAccountStore, publicProject, updateProject } from '../../../../lib/account-store.js'
import { jsonError, requireAdmin, requireUser } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { projectId } = await params
  const store = getAccountStore()
  const project = await store.getProjectById(projectId)

  if (!project || !canAccessProject(auth.user, project)) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  return Response.json({ project: publicProject(project) })
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
    const project = await updateProject(auth.user, projectId, {
      name: body?.name,
      memberIds: body?.memberIds,
      config: body?.config,
    })

    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }

    return Response.json({ project })
  } catch (error) {
    return jsonError(error, error.message?.includes('Only admins') ? 403 : 400)
  }
}

export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { projectId } = await params

  try {
    const deleted = await deleteProject(auth.user, projectId)
    if (!deleted) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error, 403)
  }
}
