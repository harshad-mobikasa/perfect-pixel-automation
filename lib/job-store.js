import { getRedisRestConfig, isRedisConfigured } from './runtime-config.js'

const JOB_KEY_PREFIX = 'audit:job:'
const USER_JOBS_PREFIX = 'audit:user-jobs:'
const QUEUE_KEY = 'audit:queue:pending'
const PROCESSING_KEY = 'audit:queue:processing'
const JOB_TTL_SECONDS = 24 * 60 * 60

const globalState = globalThis.__auditLocalState ?? {
  jobMap: new Map(),
  rateLimitMap: new Map(),
}

globalThis.__auditLocalState = globalState

class MemoryJobStore {
  constructor(state) {
    this.jobMap = state.jobMap
  }

  async createJob(jobId, job) {
    this.jobMap.set(jobId, job)
  }

  async listJobsForUser(userId, projectId) {
    const jobs = []
    for (const [id, job] of this.jobMap.entries()) {
      if (job.userId !== userId) continue
      if (projectId && job.projectId !== projectId) continue
      jobs.push({ id, ...job })
    }
    jobs.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    return jobs.slice(0, 20)
  }

  async getJob(jobId) {
    return this.jobMap.get(jobId) ?? null
  }

  async updateJob(jobId, patch) {
    const existing = this.jobMap.get(jobId)
    if (!existing) return null
    const next = { ...existing, ...patch }
    this.jobMap.set(jobId, next)
    return next
  }

  async markFinished(jobId, patch) {
    return this.updateJob(jobId, patch)
  }

  async deleteJob(jobId) {
    this.jobMap.delete(jobId)
  }

  async attachRequest(jobId, request) {
    const job = await this.getJob(jobId)
    if (!job) return
    this.jobMap.set(jobId, { ...job, request })
  }

  async enqueueJob(jobId, request) {
    await this.attachRequest(jobId, request)
  }

  async dequeueJob() {
    for (const [jobId, job] of this.jobMap.entries()) {
      if (job.status !== 'queued') continue
      const runningJob = { ...job, status: 'running', updatedAt: Date.now() }
      this.jobMap.set(jobId, runningJob)
      return { jobId, job: runningJob }
    }

    return null
  }

  async getActiveJobCount() {
    let count = 0
    for (const job of this.jobMap.values()) {
      if (job.status === 'queued' || job.status === 'running') count += 1
    }
    return count
  }

  async getRunningCount() {
    let runningCount = 0
    for (const job of this.jobMap.values()) {
      if (job.status === 'running') runningCount += 1
    }
    return runningCount
  }

  async getQueuePosition(jobId) {
    let waitingAhead = 0
    let runningCount = 0
    let found = false

    for (const [id, job] of this.jobMap.entries()) {
      if (job.status === 'running') runningCount += 1
      if (job.status !== 'queued') continue
      if (id === jobId) {
        found = true
        continue
      }
      if (!found) waitingAhead += 1
    }

    if (!found) return { position: null, waitingAhead: 0, runningCount }
    return { position: waitingAhead + 1, waitingAhead, runningCount }
  }
}

class RedisJobStore {
  jobKey(jobId) {
    return `${JOB_KEY_PREFIX}${jobId}`
  }

  userJobsKey(userId) {
    return `${USER_JOBS_PREFIX}${userId}`
  }

  async command(command) {
    const { url, token } = getRedisRestConfig()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    })

    if (!response.ok) {
      throw new Error(`Redis command failed with status ${response.status}`)
    }

    const payload = await response.json()
    if (payload.error) {
      throw new Error(payload.error)
    }

    return payload.result ?? null
  }

  async pipeline(commands) {
    const { url, token } = getRedisRestConfig()
    const response = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    })

    if (!response.ok) {
      throw new Error(`Redis pipeline failed with status ${response.status}`)
    }

    const payload = await response.json()
    return payload.map((entry) => {
      if (entry.error) {
        throw new Error(entry.error)
      }
      return entry.result ?? null
    })
  }

  async createJob(jobId, job) {
    const commands = [['SET', this.jobKey(jobId), JSON.stringify(job), 'EX', `${JOB_TTL_SECONDS}`]]
    if (job.userId) {
      commands.push(['ZADD', this.userJobsKey(job.userId), String(job.createdAt ?? Date.now()), jobId])
      commands.push(['EXPIRE', this.userJobsKey(job.userId), `${JOB_TTL_SECONDS}`])
    }
    await this.pipeline(commands)
  }

  async listJobsForUser(userId, projectId) {
    const ids = await this.command(['ZREVRANGE', this.userJobsKey(userId), '0', '19'])
    const jobs = []
    for (const id of Array.isArray(ids) ? ids : []) {
      const job = await this.getJob(id)
      if (!job) continue
      if (projectId && job.projectId !== projectId) continue
      jobs.push({ id, ...job })
    }
    return jobs
  }

  async getJob(jobId) {
    const value = await this.command(['GET', this.jobKey(jobId)])
    return value ? JSON.parse(value) : null
  }

  async updateJob(jobId, patch) {
    const existing = await this.getJob(jobId)
    if (!existing) return null
    const next = { ...existing, ...patch }
    const commands = [['SET', this.jobKey(jobId), JSON.stringify(next), 'EX', `${JOB_TTL_SECONDS}`]]
    if (next.status === 'running') {
      commands.push(['SADD', PROCESSING_KEY, jobId])
    }
    if (next.status === 'done' || next.status === 'failed') {
      commands.push(['SREM', PROCESSING_KEY, jobId])
    }
    await this.pipeline(commands)
    return next
  }

  async markFinished(jobId, patch) {
    const existing = await this.getJob(jobId)
    if (!existing) return null
    const next = { ...existing, ...patch }
    await this.pipeline([
      ['SET', this.jobKey(jobId), JSON.stringify(next), 'EX', `${JOB_TTL_SECONDS}`],
      ['SREM', PROCESSING_KEY, jobId],
    ])
    return next
  }

  async deleteJob(jobId) {
    const existing = await this.getJob(jobId)
    const commands = [
      ['DEL', this.jobKey(jobId)],
      ['LREM', QUEUE_KEY, '0', jobId],
      ['SREM', PROCESSING_KEY, jobId],
    ]
    if (existing?.userId) {
      commands.push(['ZREM', this.userJobsKey(existing.userId), jobId])
    }
    await this.pipeline(commands)
  }

  async attachRequest(jobId, request) {
    const existing = await this.getJob(jobId)
    if (!existing) return
    const next = { ...existing, request }
    await this.command(['SET', this.jobKey(jobId), JSON.stringify(next), 'EX', `${JOB_TTL_SECONDS}`])
  }

  async enqueueJob(jobId, request) {
    const existing = await this.getJob(jobId)
    if (!existing) return
    const next = { ...existing, request }
    await this.pipeline([
      ['SET', this.jobKey(jobId), JSON.stringify(next), 'EX', `${JOB_TTL_SECONDS}`],
      ['RPUSH', QUEUE_KEY, jobId],
    ])
  }

  async dequeueJob() {
    const jobId = await this.command(['LPOP', QUEUE_KEY])
    if (!jobId) return null

    const job = await this.getJob(jobId)
    if (!job) return null

    const runningJob = { ...job, status: 'running', updatedAt: Date.now() }
    await this.pipeline([
      ['SET', this.jobKey(jobId), JSON.stringify(runningJob), 'EX', `${JOB_TTL_SECONDS}`],
      ['SADD', PROCESSING_KEY, jobId],
    ])

    return { jobId, job: runningJob }
  }

  async getActiveJobCount() {
    const [queued, running] = await this.pipeline([
      ['LLEN', QUEUE_KEY],
      ['SCARD', PROCESSING_KEY],
    ])
    return Number(queued ?? 0) + Number(running ?? 0)
  }

  async compactPendingQueue() {
    const queue = await this.command(['LRANGE', QUEUE_KEY, '0', '-1'])
    const ids = Array.isArray(queue) ? queue : []
    const live = []
    const seen = new Set()

    for (const jobId of ids) {
      if (seen.has(jobId)) continue
      seen.add(jobId)
      const job = await this.getJob(jobId)
      if (job?.status === 'queued') live.push(jobId)
    }

    await this.command(['DEL', QUEUE_KEY])
    if (live.length > 0) {
      await this.command(['RPUSH', QUEUE_KEY, ...live])
    }

    return live
  }

  async getRunningCount() {
    const members = await this.command(['SMEMBERS', PROCESSING_KEY])
    const ids = Array.isArray(members) ? members : []
    let runningCount = 0
    for (const jobId of ids) {
      const job = await this.getJob(jobId)
      if (job?.status === 'running') {
        runningCount += 1
        continue
      }
      await this.command(['SREM', PROCESSING_KEY, jobId])
    }
    return runningCount
  }

  async getQueuePosition(jobId) {
    const live = await this.compactPendingQueue()
    const runningCount = await this.getRunningCount()
    const index = live.indexOf(jobId)
    if (index === -1) return { position: null, waitingAhead: 0, runningCount }
    return { position: index + 1, waitingAhead: index, runningCount }
  }
}

let singletonStore = null

function getJobStore() {
  if (!singletonStore) {
    singletonStore = isRedisConfigured()
      ? new RedisJobStore()
      : new MemoryJobStore(globalState)
  }

  return singletonStore
}

const rateLimitMap = globalState.rateLimitMap

export { getJobStore, globalState, rateLimitMap }
