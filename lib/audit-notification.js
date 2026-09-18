import { getAccountStore } from './account-store.js'
import { sendAuditResultEmail } from './mailer.js'

async function sendAuditResultNotification(jobStore, jobId) {
  const job = await jobStore.getJob(jobId)
  const recipient = job?.createdBy?.email
  if (!recipient || (job.status !== 'done' && job.status !== 'failed')) return { sent: false }

  let projectName = job.projectId ?? 'Unknown project'
  if (job.projectId) {
    const store = getAccountStore()
    const project = await store.getProjectById(job.projectId).catch(() => null)
    projectName = project?.name ?? projectName
  }

  try {
    await sendAuditResultEmail({
      to: recipient,
      name: job.createdBy?.name || recipient,
      projectName,
      suite: job.suite ?? 'audit',
      status: job.status,
      reportFiles: job.reportFiles ?? [],
      error: job.error,
      jobId,
    })
    const sentAt = Date.now()
    await jobStore.updateJob(jobId, {
      emailNotificationSentAt: sentAt,
      emailNotificationError: null,
      updatedAt: sentAt,
    })
    return { sent: true, sentAt }
  } catch (error) {
    const attemptedAt = Date.now()
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Email notification failed'
    await jobStore.updateJob(jobId, {
      emailNotificationAttemptedAt: attemptedAt,
      emailNotificationError: message,
      updatedAt: attemptedAt,
    })
    return { sent: false, error: message }
  }
}

export { sendAuditResultNotification }
