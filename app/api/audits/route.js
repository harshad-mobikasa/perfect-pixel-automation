import { randomUUID } from 'node:crypto'
import { getJobStore, rateLimitMap } from '../../../lib/job-store.js'
import { enqueueAudit, getActiveJobCount } from '../../../lib/audit-runner.js'
import { parseAuditFormData } from '../../../lib/audit-request.js'
import { getFileStore } from '../../../lib/shopify-file-store.js'
import { isShopifyFilesConfigured, shouldProcessAuditsInCurrentProcess } from '../../../lib/runtime-config.js'
import { validateAuditRequest } from '../../../lib/ssrf-guard.js'
import { canAccessProject, getAccountStore } from '../../../lib/account-store.js'
import { triggerGitHubAuditWorker } from '../../../lib/github-actions.js'
import { jsonNoStore, requireUser } from '../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RATE_LIMIT = 5
const RATE_WINDOW_MS = 10 * 60 * 1000
const QUEUE_CAP = 20
const WORKER_TRIGGER_RETRY_MS = 5 * 60 * 1000

async function getWorkerStatus(jobStore) {
  const heartbeat =
    typeof jobStore.getWorkerHeartbeat === 'function' ? await jobStore.getWorkerHeartbeat() : null
  return {
    workerRequired: !shouldProcessAuditsInCurrentProcess(),
    workerOnline: Boolean(heartbeat?.at),
    workerLastSeenAt: heartbeat?.at ?? null,
  }
}

async function summarizeUserJobs(jobStore, userId, projectId) {
  const jobs = await jobStore.listJobsForUser(userId, projectId)
  const live = typeof jobStore.listPendingQueue === 'function' ? await jobStore.listPendingQueue() : null
  const worker = await getWorkerStatus(jobStore)
  const runningCount =
    typeof jobStore.getRunningCount === 'function'
      ? await jobStore.getRunningCount()
      : (await jobStore.getQueuePosition(jobs[0]?.id ?? ''))?.runningCount ?? 0

  const summaries = []
  for (const job of jobs) {
    if (job.userId !== userId) continue
    let queue = { position: null, waitingAhead: 0, runningCount }
    if (job.status === 'queued') {
      if (Array.isArray(live)) {
        let index = live.indexOf(job.id)
        if (index === -1 && typeof jobStore.ensureQueuedJob === 'function' && (await jobStore.ensureQueuedJob(job.id))) {
          live.push(job.id)
          index = live.length - 1
        }
        queue =
          index === -1
            ? { position: null, waitingAhead: 0, runningCount }
            : { position: index + 1, waitingAhead: index, runningCount }
      } else {
        queue = await jobStore.getQueuePosition(job.id)
      }
    }
    summaries.push({
      id: job.id,
      status: job.status,
      suite: job.suite ?? null,
      error: job.error ?? null,
      stage: job.stage ?? null,
      progress: job.progress ?? null,
      lastMessage: job.lastMessage ?? null,
      createdAt: job.createdAt ?? null,
      queuedForSec: job.status === 'queued' && job.createdAt ? Math.max(0, Math.round((Date.now() - job.createdAt) / 1000)) : null,
      queuePosition: queue?.position ?? null,
      waitingAhead: queue?.waitingAhead ?? 0,
      runningCount: queue?.runningCount ?? runningCount,
      workerRequired: worker.workerRequired,
      workerOnline: worker.workerOnline,
      workerLastSeenAt: worker.workerLastSeenAt,
      workerTriggeredAt: job.workerTriggeredAt ?? null,
      reportFiles:
        job.status === 'done' ? (job.reportFiles ?? []).map((file) => ({ fileName: file.fileName })) : [],
    })
  }
  return summaries
}

async function retryStaleGitHubWorkerTrigger(jobStore, userId, projectId) {
  const worker = await getWorkerStatus(jobStore)
  if (!worker.workerRequired || worker.workerOnline) return

  const jobs = await jobStore.listJobsForUser(userId, projectId)
  const retryJob = jobs.find((job) => {
    if (job.userId !== userId || job.projectId !== projectId || job.status !== 'queued') return false
    const triggeredAt = job.workerTriggeredAt ?? 0
    return !triggeredAt || Date.now() - triggeredAt >= WORKER_TRIGGER_RETRY_MS
  })
  if (!retryJob) return

  const now = Date.now()
  await jobStore.updateJob(retryJob.id, {
    updatedAt: now,
    workerTriggeredAt: now,
    lastMessage: 'Queued and GitHub Actions worker started',
  })

  const workerTrigger = await triggerGitHubAuditWorker(retryJob.id).catch((err) => ({
    status: 'failed',
    reason: err instanceof Error ? err.message : 'GitHub dispatch failed',
  }))

  if (workerTrigger.status === 'failed') {
    await jobStore.updateJob(retryJob.id, {
      updatedAt: Date.now(),
      lastMessage: 'Queued, but the GitHub worker did not start automatically',
    })
  } else if (workerTrigger.status === 'skipped') {
    await jobStore.updateJob(retryJob.id, {
      updatedAt: Date.now(),
      lastMessage:
        workerTrigger.reason === 'GitHub worker was triggered recently'
          ? 'Queued; a recent GitHub Actions worker will pick this up'
          : 'Queued, but GitHub worker trigger is not configured',
    })
  }
}

export async function GET(request) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const projectId = new URL(request.url).searchParams.get('projectId') ?? ''
  if (!projectId) {
    return Response.json({ error: 'projectId is required' }, { status: 400 })
  }

  const accountStore = getAccountStore()
  const project = await accountStore.getProjectById(projectId)
  if (!project || !canAccessProject(auth.user, project)) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  const jobStore = getJobStore()
  if (typeof jobStore.recoverStaleRunningJobs === 'function') {
    await jobStore.recoverStaleRunningJobs()
  }
  await retryStaleGitHubWorkerTrigger(jobStore, auth.user.id, projectId)
  const jobs = await summarizeUserJobs(jobStore, auth.user.id, projectId)
  return jsonNoStore({ jobs })
}

function clientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

function checkRateLimit(ip) {
  const now = Date.now()
  const timestamps = (rateLimitMap.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (timestamps.length >= RATE_LIMIT) {
    throw new Error('Rate limit exceeded — max 5 requests per 10 minutes per IP')
  }
  timestamps.push(now)
  rateLimitMap.set(ip, timestamps)
}

export async function POST(request) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  let auditRequest
  let projectId
  try {
    const formData = await request.formData()
    projectId = typeof formData.get('projectId') === 'string' ? formData.get('projectId').trim() : ''
    if (!projectId) {
      throw new Error('Select a project before starting an audit')
    }
    auditRequest = await parseAuditFormData(formData)
  } catch (err) {
    return Response.json({ error: err.message ?? 'Invalid audit request' }, { status: 400 })
  }

  const accountStore = getAccountStore()
  const project = await accountStore.getProjectById(projectId)
  if (!project || !canAccessProject(auth.user, project)) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  try {
    await validateAuditRequest(auditRequest.url, auditRequest.suite)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 })
  }

  const ip = clientIp(request)
  try {
    checkRateLimit(ip)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 429 })
  }

  const jobStore = getJobStore()
  const fileStore = getFileStore()

  if ((await getActiveJobCount(jobStore)) >= QUEUE_CAP) {
    return Response.json({ error: 'Server is busy — try again later' }, { status: 503 })
  }

  const jobId = randomUUID()
  const initialJob = {
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    workDir: null,
    pdfPath: null,
    reportFiles: [],
    suite: auditRequest.suite,
    stage: 'Queued',
    progress: 5,
    lastMessage: 'Waiting for an available audit slot',
    error: null,
    userId: auth.user.id,
    projectId,
    createdBy: {
      userId: auth.user.id,
      name: auth.user.name,
      email: auth.user.email,
    },
  }

  await jobStore.createJob(jobId, initialJob)

  let normalizedRequest
  try {
    normalizedRequest = isShopifyFilesConfigured()
      ? await fileStore.persistAuditRequestAssets(jobId, auditRequest)
      : auditRequest
  } catch (err) {
    await jobStore.deleteJob(jobId)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to store audit files in Shopify' },
      { status: 500 },
    )
  }

  const processHere = shouldProcessAuditsInCurrentProcess()
  let workerTrigger = null

  try {
    if (processHere) {
      await jobStore.attachRequest(jobId, normalizedRequest)
    } else {
      await jobStore.enqueueJob(jobId, normalizedRequest)
    }
  } catch (err) {
    await jobStore.deleteJob(jobId)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to enqueue audit job' },
      { status: 500 },
    )
  }

  if (processHere) {
    enqueueAudit(jobId, normalizedRequest, {
      jobStore,
      fileStore,
      persistReports: isShopifyFilesConfigured(),
    })
  } else {
    const triggerStartedAt = Date.now()
    await jobStore.updateJob(jobId, {
      updatedAt: triggerStartedAt,
      workerTriggeredAt: triggerStartedAt,
      lastMessage: 'Queued and starting GitHub Actions worker',
    })

    workerTrigger = await triggerGitHubAuditWorker(jobId).catch((err) => ({
      status: 'failed',
      reason: err instanceof Error ? err.message : 'GitHub dispatch failed',
    }))
    if (workerTrigger.status === 'failed') {
      await jobStore.updateJob(jobId, {
        updatedAt: Date.now(),
        lastMessage: 'Queued, but the GitHub worker did not start automatically',
      })
    } else if (workerTrigger.status === 'triggered') {
      await jobStore.updateJob(jobId, {
        updatedAt: Date.now(),
        lastMessage: 'Queued and GitHub Actions worker started',
      })
    } else if (workerTrigger.status === 'skipped') {
      await jobStore.updateJob(jobId, {
        updatedAt: Date.now(),
        lastMessage:
          workerTrigger.reason === 'GitHub worker was triggered recently'
            ? 'Queued; a recent GitHub Actions worker will pick this up'
            : 'Queued, but GitHub worker trigger is not configured',
      })
    }
  }

  return Response.json(
    {
      jobId,
      mode: processHere ? 'local' : 'shared-worker',
      workerTrigger,
    },
    { status: 202 },
  )
}
