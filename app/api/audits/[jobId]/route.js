import { jobMap } from '../../../../lib/job-store.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getQueuePosition(jobId) {
  let position = 0

  for (const [id, job] of jobMap.entries()) {
    if (job.status !== 'queued') continue
    position += 1
    if (id === jobId) {
      return position
    }
  }

  return null
}

export async function GET(request, { params }) {
  const { jobId } = await params
  const job = jobMap.get(jobId)

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  return Response.json({
    status: job.status,
    error: job.error ?? null,
    stage: job.stage ?? null,
    progress: job.progress ?? null,
    lastMessage: job.lastMessage ?? null,
    queuePosition: job.status === 'queued' ? getQueuePosition(jobId) : null,
    reportFiles:
      job.status === 'done'
        ? (job.reportFiles ?? []).map((file) => ({ fileName: file.fileName }))
        : [],
  })
}
