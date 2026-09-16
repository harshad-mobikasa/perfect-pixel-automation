import './load-env.mjs'

const { getJobStore } = await import('../lib/job-store.js')
const { getFileStore } = await import('../lib/shopify-file-store.js')
const { runAudit } = await import('../lib/audit-runner.js')
const { cleanupExpiredReports } = await import('../lib/report-store.js')
const { pruneActivity } = await import('../lib/activity-log.js')
const { isSharedInfrastructureConfigured } = await import('../lib/runtime-config.js')

const WORKER_ID = `${process.env.GITHUB_RUN_ID || process.env.HOSTNAME || 'audit-worker-once'}:${process.pid}`

async function main() {
  if (!isSharedInfrastructureConfigured()) {
    console.error(
      'Shared worker mode requires UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, SHOPIFY_STORE_URL, and SHOPIFY_ADMIN_ACCESS_TOKEN.',
    )
    process.exit(1)
  }

  const jobStore = getJobStore()
  const fileStore = getFileStore()

  await jobStore.recordWorkerHeartbeat(WORKER_ID).catch((error) => {
    console.error('Worker heartbeat failed', error)
  })
  await cleanupExpiredReports().catch((error) => {
    console.error('Report cleanup failed', error)
  })
  await pruneActivity().catch((error) => {
    console.error('Activity log cleanup failed', error)
  })

  const nextJob = await jobStore.dequeueJob()
  if (!nextJob) {
    console.log('No queued audit jobs found')
    return
  }

  const { jobId, job } = nextJob
  const auditRequest = job.request

  if (!auditRequest) {
    await jobStore.markFinished(jobId, {
      status: 'failed',
      completedAt: Date.now(),
      updatedAt: Date.now(),
      workDir: null,
      stage: 'Audit failed',
      error: 'Queued job is missing its audit request payload',
    })
    return
  }

  console.log(`Running audit job ${jobId} (${auditRequest.suite})`)

  await runAudit(jobId, auditRequest, {
    jobStore,
    fileStore,
    persistReports: true,
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
