import { getJobStore } from '../../../../lib/job-store.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request, { params }) {
  const { jobId } = await params
  const jobStore = getJobStore()
  const job = await jobStore.getJob(jobId)

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  return Response.json({
    status: job.status,
    error: job.error ?? null,
    stage: job.stage ?? null,
    progress: job.progress ?? null,
    lastMessage: job.lastMessage ?? null,
    queuePosition: job.status === 'queued' ? await jobStore.getQueuePosition(jobId) : null,
    reportFiles:
      job.status === 'done'
        ? (job.reportFiles ?? []).map((file) => ({ fileName: file.fileName }))
        : [],
  })
}
