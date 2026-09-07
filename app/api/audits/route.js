import { randomUUID } from 'node:crypto'
import { jobMap, rateLimitMap } from '../../../lib/job-store.js'
import { enqueueAudit, getActiveJobCount } from '../../../lib/audit-runner.js'
import { parseAuditFormData } from '../../../lib/audit-request.js'
import { validateAuditRequest } from '../../../lib/ssrf-guard.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  if (getActiveJobCount() >= QUEUE_CAP) {
    return Response.json({ error: 'Server is busy — try again later' }, { status: 503 })
  }

  const jobId = randomUUID()
  jobMap.set(jobId, {
    status: 'queued',
    createdAt: Date.now(),
    workDir: null,
    pdfPath: null,
    suite: auditRequest.suite,
    error: null,
  })

  enqueueAudit(jobId, auditRequest)

  return Response.json({ jobId }, { status: 202 })
}
