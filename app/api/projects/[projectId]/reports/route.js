import { deleteProjectReports, listProjectReports } from '../../../../../lib/report-store.js'
import { jsonError, requireUser } from '../../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { projectId } = await params

  try {
    const reports = await listProjectReports(auth.user, projectId)
    if (!reports) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
    return Response.json({ reports })
  } catch (error) {
    return jsonError(error, 500)
  }
}

export async function DELETE(request, { params }) {
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
    const result = await deleteProjectReports(auth.user, projectId, body?.runIds)
    if (!result) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }
    return Response.json(result)
  } catch (error) {
    return jsonError(error, error.message?.includes('cannot') ? 403 : 400)
  }
}
