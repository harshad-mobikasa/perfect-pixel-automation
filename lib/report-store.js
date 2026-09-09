import { randomUUID } from 'node:crypto'
import { isRedisConfigured, redisCommand } from './redis-client.js'
import { getAccountStore } from './account-store.js'
import { getFileStore } from './shopify-file-store.js'
import { canAccessProject, clampRetentionDays } from './roles.js'

const RUN_KEY_PREFIX = 'audit:run:'
const PROJECT_RUNS_PREFIX = 'audit:project-runs:'

const globalState = globalThis.__auditReportState ?? {
  runs: new Map(),
  projectRuns: new Map(),
}

globalThis.__auditReportState = globalState

function runKey(runId) {
  return `${RUN_KEY_PREFIX}${runId}`
}

function projectRunsKey(projectId) {
  return `${PROJECT_RUNS_PREFIX}${projectId}`
}

function parseJson(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function saveRun(run) {
  if (isRedisConfigured()) {
    await redisCommand(['SET', runKey(run.id), JSON.stringify(run)])
    await redisCommand(['ZADD', projectRunsKey(run.projectId), String(run.createdAt), run.id])
    return
  }

  globalState.runs.set(run.id, structuredClone(run))
  const list = globalState.projectRuns.get(run.projectId) ?? []
  globalState.projectRuns.set(run.projectId, [run.id, ...list.filter((id) => id !== run.id)])
}

async function getRun(runId) {
  if (isRedisConfigured()) {
    return parseJson(await redisCommand(['GET', runKey(runId)]))
  }
  return globalState.runs.get(runId) ?? null
}

async function deleteRunRecord(run) {
  const fileStore = getFileStore()
  try {
    await fileStore.deleteFiles(run.files ?? [])
  } catch {
    // Keep going so project history can still drop the expired record.
  }

  if (isRedisConfigured()) {
    await redisCommand(['DEL', runKey(run.id)])
    await redisCommand(['ZREM', projectRunsKey(run.projectId), run.id])
    return
  }

  globalState.runs.delete(run.id)
  globalState.projectRuns.set(
    run.projectId,
    (globalState.projectRuns.get(run.projectId) ?? []).filter((id) => id !== run.id),
  )
}

async function listRunIds(projectId) {
  if (isRedisConfigured()) {
    const ids = await redisCommand(['ZREVRANGE', projectRunsKey(projectId), '0', '-1'])
    return Array.isArray(ids) ? ids : []
  }
  return globalState.projectRuns.get(projectId) ?? []
}

async function archiveProjectRun(job, reportFiles) {
  if (!job?.projectId || job.status !== 'done') return null

  const store = getAccountStore()
  const project = await store.getProjectById(job.projectId)
  const retentionDays = clampRetentionDays(project?.retentionDays)
  const createdAt = job.completedAt ?? Date.now()

  const run = {
    id: randomUUID(),
    jobId: job.id ?? job.jobId,
    projectId: job.projectId,
    suite: job.suite,
    status: 'done',
    createdAt,
    createdBy: job.createdBy ?? {
      userId: job.userId ?? null,
      name: 'Unknown',
      email: '',
    },
    files: (reportFiles ?? []).map((file) => ({
      fileName: file.fileName,
      fileId: file.fileId ?? null,
      url: file.url ?? null,
    })),
    retentionDays,
    expiresAt: createdAt + retentionDays * 24 * 60 * 60 * 1000,
  }

  await saveRun(run)
  return run
}

function isExpired(run, retentionDays) {
  const keepMs = clampRetentionDays(retentionDays ?? run.retentionDays) * 24 * 60 * 60 * 1000
  return Date.now() - run.createdAt > keepMs
}

async function listProjectReports(actor, projectId) {
  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project || !canAccessProject(actor, project)) {
    return null
  }

  const retentionDays = clampRetentionDays(project.retentionDays)
  const ids = await listRunIds(projectId)
  const reports = []

  for (const runId of ids) {
    const run = await getRun(runId)
    if (!run) continue
    if (isExpired(run, retentionDays)) {
      await deleteRunRecord(run)
      continue
    }
    reports.push({
      ...run,
      retentionDays,
      expiresAt: run.createdAt + retentionDays * 24 * 60 * 60 * 1000,
    })
  }

  return reports
}

async function getProjectReport(actor, projectId, runId) {
  const reports = await listProjectReports(actor, projectId)
  if (!reports) return { error: 'not-found' }
  return reports.find((run) => run.id === runId) ?? null
}

async function cleanupExpiredReports() {
  const store = getAccountStore()
  const projects = await store.listProjects()

  for (const project of projects) {
    const ids = await listRunIds(project.id)
    const retentionDays = clampRetentionDays(project.retentionDays)
    for (const runId of ids) {
      const run = await getRun(runId)
      if (!run || isExpired(run, retentionDays)) {
        if (run) await deleteRunRecord(run)
      }
    }
  }
}

export { archiveProjectRun, cleanupExpiredReports, getProjectReport, getRun, listProjectReports }
