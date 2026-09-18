import { getAccountStore } from '../../../../lib/account-store.js'
import { triggerGitHubAuditWorker } from '../../../../lib/github-actions.js'
import { getJobStore } from '../../../../lib/job-store.js'
import { jsonError, requireAdmin } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function publicJob(job, projects) {
  return {
    id: job.id,
    status: job.status,
    suite: job.suite ?? null,
    projectName: projects.get(job.projectId) ?? job.projectId ?? 'Unknown',
    requester: job.createdBy ?? { name: 'Unknown', email: '' },
    createdAt: job.createdAt ?? null,
    updatedAt: job.updatedAt ?? null,
    completedAt: job.completedAt ?? null,
    stage: job.stage ?? null,
    error: job.error ?? null,
    emailNotificationSentAt: job.emailNotificationSentAt ?? null,
    emailNotificationError: job.emailNotificationError ?? null,
  }
}

async function listRecentJobs(jobStore, accountStore) {
  const [users, projects] = await Promise.all([accountStore.listUsers(), accountStore.listProjects()])
  const projectMap = new Map(projects.map((project) => [project.id, project.name]))
  const byId = new Map()
  for (const user of users) {
    const jobs = await jobStore.listJobsForUser(user.id)
    for (const job of jobs) byId.set(job.id, publicJob(job, projectMap))
  }
  return [...byId.values()]
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    .slice(0, 50)
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const jobStore = getJobStore()
    const accountStore = getAccountStore()
    if (typeof jobStore.recoverStaleRunningJobs === 'function') {
      await jobStore.recoverStaleRunningJobs()
    }
    const jobs = await listRecentJobs(jobStore, accountStore)
    return Response.json({ jobs })
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

  const jobId = typeof body?.jobId === 'string' ? body.jobId : ''
  const action = typeof body?.action === 'string' ? body.action : ''
  if (!jobId) return Response.json({ error: 'jobId is required' }, { status: 400 })

  try {
    const jobStore = getJobStore()
    const job = await jobStore.getJob(jobId)
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 })

    if (action === 'delete') {
      await jobStore.deleteJob(jobId)
      return Response.json({ ok: true })
    }

    if (action === 'retry') {
      if (!job.request) {
        return Response.json({ error: 'Job request is not available for retry' }, { status: 400 })
      }
      const now = Date.now()
      await jobStore.updateJob(jobId, {
        status: 'queued',
        startedAt: null,
        completedAt: null,
        updatedAt: now,
        workerTriggeredAt: now,
        stage: 'Queued',
        progress: 5,
        lastMessage: 'Queued by admin retry',
        error: null,
      })
      await jobStore.enqueueJob(jobId, job.request)
      const workerTrigger = await triggerGitHubAuditWorker(jobId).catch((error) => ({
        status: 'failed',
        reason: error instanceof Error ? error.message : 'GitHub dispatch failed',
      }))
      return Response.json({ ok: true, workerTrigger })
    }

    return Response.json({ error: 'Unsupported action' }, { status: 400 })
  } catch (error) {
    return jsonError(error, 500)
  }
}
