import { getJobStore } from '../../../../../lib/job-store.js'
import { canAccessJob } from '../../../../../lib/account-store.js'
import { sendAuditResultNotification } from '../../../../../lib/audit-notification.js'
import { requireUser } from '../../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { jobId } = await params
  const jobStore = getJobStore()
  const job = await jobStore.getJob(jobId)
  if (!job || !(await canAccessJob(auth.user, job))) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'done' && job.status !== 'failed') {
    return Response.json({ error: 'Audit is not finished yet' }, { status: 400 })
  }

  const result = await sendAuditResultNotification(jobStore, jobId)
  if (!result.sent) {
    return Response.json({ error: result.error ?? 'Email notification could not be sent' }, { status: 502 })
  }

  return Response.json({ ok: true, emailNotificationSentAt: result.sentAt })
}
