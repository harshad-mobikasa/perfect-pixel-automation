import { jobMap } from '../../../../lib/job-store.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { jobId } = await params
  const job = jobMap.get(jobId)

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  return Response.json({
    status: job.status,
    error: job.error ?? null,
  })
}
