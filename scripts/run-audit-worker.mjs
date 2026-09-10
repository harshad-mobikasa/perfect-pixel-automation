import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const initialEnv = new Set(Object.keys(process.env))

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName)
  if (!existsSync(filePath)) return

  const contents = readFileSync(filePath, 'utf8')
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/)
    if (!match) continue

    const key = match[1]
    if (initialEnv.has(key)) continue

    let value = match[2] ?? ''
    value = value.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }

    process.env[key] = value
  }
}

loadEnvFile('.env')
loadEnvFile('.env.local')

const { getJobStore } = await import('../lib/job-store.js')
const { getFileStore } = await import('../lib/shopify-file-store.js')
const { runAudit } = await import('../lib/audit-runner.js')
const { cleanupExpiredReports } = await import('../lib/report-store.js')
const { pruneActivity } = await import('../lib/activity-log.js')
const { isSharedInfrastructureConfigured } = await import('../lib/runtime-config.js')

const POLL_INTERVAL_MS = 3000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const WORKER_ID = `${process.env.HOSTNAME || 'audit-worker'}:${process.pid}`

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
    await jobStore.recordWorkerHeartbeat(WORKER_ID).catch((error) => {
      console.error('Worker heartbeat failed', error)
    })

    if (Date.now() - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
      lastCleanupAt = Date.now()
      await cleanupExpiredReports().catch((error) => {
        console.error('Report cleanup failed', error)
      })
      await pruneActivity().catch((error) => {
        console.error('Activity log cleanup failed', error)
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
