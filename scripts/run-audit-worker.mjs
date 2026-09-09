import { getJobStore } from '../lib/job-store.js'
import { getFileStore } from '../lib/shopify-file-store.js'
import { runAudit } from '../lib/audit-runner.js'
import { cleanupExpiredReports } from '../lib/report-store.js'
import { isSharedInfrastructureConfigured } from '../lib/runtime-config.js'

const POLL_INTERVAL_MS = 3000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  if (!isSharedInfrastructureConfigured()) {
    console.error(
      'Shared worker mode requires UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, SHOPIFY_STORE_URL, and SHOPIFY_ADMIN_ACCESS_TOKEN.',
    )
    process.exit(1)
  }

  const jobStore = getJobStore()
  const fileStore = getFileStore()

  console.log('Audit worker started')
  let lastCleanupAt = 0

  while (true) {
    if (Date.now() - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
      lastCleanupAt = Date.now()
      await cleanupExpiredReports().catch((error) => {
        console.error('Report cleanup failed', error)
      })
    }

    const nextJob = await jobStore.dequeueJob()
    if (!nextJob) {
      await sleep(POLL_INTERVAL_MS)
      continue
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
      continue
    }

    console.log(`Running audit job ${jobId} (${auditRequest.suite})`)

    await runAudit(jobId, auditRequest, {
      jobStore,
      fileStore,
      persistReports: true,
    })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
