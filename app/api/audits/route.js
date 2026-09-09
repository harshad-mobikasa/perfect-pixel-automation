import { randomUUID } from 'node:crypto'
import { getJobStore, rateLimitMap } from '../../../lib/job-store.js'
import { enqueueAudit, getActiveJobCount } from '../../../lib/audit-runner.js'
import { parseAuditFormData } from '../../../lib/audit-request.js'
import { getFileStore } from '../../../lib/shopify-file-store.js'
import { isShopifyFilesConfigured, shouldProcessAuditsInCurrentProcess } from '../../../lib/runtime-config.js'
import { validateAuditRequest } from '../../../lib/ssrf-guard.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RATE_LIMIT = 5
const RATE_WINDOW_MS = 10 * 60 * 1000
const QUEUE_CAP = 20

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
  let auditRequest
  try {
    const formData = await request.formData()
    auditRequest = await parseAuditFormData(formData)
  } catch (err) {
    return Response.json({ error: err.message ?? 'Invalid audit request' }, { status: 400 })
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
  }

  return Response.json(
    {
      jobId,
      mode: processHere ? 'local' : 'shared-worker',
    },
    { status: 202 },
  )
}
