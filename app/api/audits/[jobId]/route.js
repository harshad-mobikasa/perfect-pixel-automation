import { getJobStore } from '../../../../lib/job-store.js'
import { canAccessJob } from '../../../../lib/account-store.js'
import { requireUser } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { jobId } = await params
  const jobStore = getJobStore()
  const job = await jobStore.getJob(jobId)

  if (!job || !(await canAccessJob(auth.user, job))) {
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
