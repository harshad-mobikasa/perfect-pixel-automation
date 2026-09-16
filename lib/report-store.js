import { randomUUID } from 'node:crypto'
import { isRedisConfigured, redisCommand } from './redis-client.js'
import { getAccountStore } from './account-store.js'
import { getFileStore } from './shopify-file-store.js'
import { canAccessProject, canManageProject, clampRetentionDays } from './roles.js'
import { recordActivity } from './activity-log.js'

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

async function listRunIds(projectId, options = {}) {
  const minScore = options.minScore ?? 0
  const maxScore = options.maxScore ?? Date.now()
  const offset = options.offset ?? 0
  const count = options.count

  if (isRedisConfigured()) {
    const command = ['ZREVRANGEBYSCORE', projectRunsKey(projectId), String(maxScore), String(minScore)]
    if (count != null) {
      command.push('LIMIT', String(offset), String(count))
    }
    const ids = await redisCommand(command)
    return Array.isArray(ids) ? ids : []
  }

  const runs = (globalState.projectRuns.get(projectId) ?? [])
    .map((id) => globalState.runs.get(id))
    .filter((run) => run && run.createdAt >= minScore && run.createdAt <= maxScore)
    .sort((left, right) => right.createdAt - left.createdAt)
  const sliced = count != null ? runs.slice(offset, offset + count) : runs
  return sliced.map((run) => run.id)
}

async function countRunIds(projectId, minScore, maxScore) {
  if (isRedisConfigured()) {
    const counted = await redisCommand([
      'ZCOUNT',
      projectRunsKey(projectId),
      String(minScore ?? '-inf'),
      String(maxScore ?? '+inf'),
    ])
    return Number(counted) || 0
  }

  return (globalState.projectRuns.get(projectId) ?? []).filter((id) => {
    const run = globalState.runs.get(id)
    return run && run.createdAt >= (minScore ?? 0) && run.createdAt <= (maxScore ?? Date.now())
  }).length
}

async function getRunsByIds(ids) {
  if (ids.length === 0) return []
  if (isRedisConfigured()) {
    const values = await redisCommand(['MGET', ...ids.map((id) => runKey(id))])
    return (Array.isArray(values) ? values : []).map(parseJson).filter(Boolean)
  }
  return ids.map((id) => globalState.runs.get(id)).filter(Boolean)
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
  await recordActivity(job.createdBy, 'report.created', {
    projectId: job.projectId,
    projectName: project?.name,
    target: { type: 'report', id: run.id, name: job.suite },
    detail: `${job.suite} report saved`,
  })
  return run
}

function isExpired(run, retentionDays) {
  const keepMs = clampRetentionDays(retentionDays ?? run.retentionDays) * 24 * 60 * 60 * 1000
  return Date.now() - run.createdAt > keepMs
}

async function listProjectReports(actor, projectId, options = {}) {
  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project || !canAccessProject(actor, project)) {
    return null
  }

  const retentionDays = clampRetentionDays(project.retentionDays)
  const page = Math.max(1, Number.parseInt(String(options.page ?? '1'), 10) || 1)
  const pageSize = Math.min(50, Math.max(10, Number.parseInt(String(options.pageSize ?? '20'), 10) || 20))
  const from = typeof options.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.from) ? options.from : ''
  const to = typeof options.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.to) ? options.to : ''
  const minScore = from ? new Date(`${from}T00:00:00`).getTime() : 0
  const maxScore = to ? new Date(`${to}T23:59:59.999`).getTime() : Date.now()
  const offset = (page - 1) * pageSize

  const ids = await listRunIds(projectId, {
    minScore,
    maxScore,
    offset,
    count: pageSize,
  })
  const total = await countRunIds(projectId, minScore, maxScore)
  const runs = await getRunsByIds(ids)
  const reports = []

  for (const run of runs) {
    if (isExpired(run, retentionDays)) continue
    reports.push({
      ...run,
      retentionDays,
      expiresAt: run.createdAt + retentionDays * 24 * 60 * 60 * 1000,
    })
  }

  return { reports, total, page, pageSize, from, to }
}

async function getProjectReport(actor, projectId, runId) {
  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project || !canAccessProject(actor, project)) {
    return { error: 'not-found' }
  }
  const run = await getRun(runId)
  if (!run || run.projectId !== projectId) return null
  if (isExpired(run, project.retentionDays)) return null
  return run
}

async function deleteProjectReports(actor, projectId, runIds) {
  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project || !canManageProject(actor, project)) {
    return null
  }

  const wanted = new Set(
    (Array.isArray(runIds) ? runIds : [])
      .filter((id) => typeof id === 'string' && id.trim())
      .slice(0, 100),
  )
  if (wanted.size === 0) {
    throw new Error('Select at least one report to delete')
  }

  let deleted = 0
  for (const runId of wanted) {
    const run = await getRun(runId)
    if (!run || run.projectId !== projectId) continue
    await deleteRunRecord(run)
    deleted += 1
    await recordActivity(actor, 'report.deleted', {
      projectId,
      projectName: project.name,
      target: { type: 'report', id: run.id, name: run.suite },
      detail: `${run.suite} report deleted`,
    })
  }

  return { deleted }
}

async function cleanupExpiredReports() {
  const store = getAccountStore()
  const projects = await store.listProjects()

  for (const project of projects) {
    const ids = await listRunIds(project.id)
    const retentionDays = clampRetentionDays(project.retentionDays)
    const runs = await getRunsByIds(ids)
    for (const run of runs) {
      if (isExpired(run, retentionDays)) {
        await deleteRunRecord(run)
      }
    }
  }
}

export {
  archiveProjectRun,
  cleanupExpiredReports,
  deleteProjectReports,
  getProjectReport,
  getRun,
  listProjectReports,
}
