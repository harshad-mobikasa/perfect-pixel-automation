import { getJobStore } from '../../../../lib/job-store.js'
import { canAccessJob } from '../../../../lib/account-store.js'
import { jsonNoStore, requireUser } from '../../../../lib/require-auth.js'
import { shouldProcessAuditsInCurrentProcess } from '../../../../lib/runtime-config.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { jobId } = await params
  const jobStore = getJobStore()
  if (typeof jobStore.recoverStaleRunningJobs === 'function') {
    await jobStore.recoverStaleRunningJobs()
  }
  const job = await jobStore.getJob(jobId)

  if (!job || !(await canAccessJob(auth.user, job))) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  let queue = job.status === 'queued' ? await jobStore.getQueuePosition(jobId) : null
  if (job.status === 'queued' && !queue?.position && typeof jobStore.ensureQueuedJob === 'function') {
    const repaired = await jobStore.ensureQueuedJob(jobId)
    if (repaired) {
      queue = await jobStore.getQueuePosition(jobId)
    }
  }
  const workerHeartbeat =
    typeof jobStore.getWorkerHeartbeat === 'function' ? await jobStore.getWorkerHeartbeat() : null

  return jsonNoStore({
    status: job.status,
    error: job.error ?? null,
    stage: job.stage ?? null,
    progress: job.progress ?? null,
    lastMessage: job.lastMessage ?? null,
    suite: job.suite ?? null,
    queuedForSec: job.status === 'queued' && job.createdAt ? Math.max(0, Math.round((Date.now() - job.createdAt) / 1000)) : null,
    queuePosition: queue?.position ?? null,
    waitingAhead: queue?.waitingAhead ?? 0,
    runningCount: queue?.runningCount ?? 0,
    workerRequired: !shouldProcessAuditsInCurrentProcess(),
    workerOnline: Boolean(workerHeartbeat?.at),
    workerLastSeenAt: workerHeartbeat?.at ?? null,
    reportFiles:
      job.status === 'done'
        ? (job.reportFiles ?? []).map((file) => ({ fileName: file.fileName }))
        : [],
  })
}
