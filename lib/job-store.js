import { getRedisRestConfig, isRedisConfigured } from './runtime-config.js'

const JOB_KEY_PREFIX = 'audit:job:'
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

  async getQueuePosition(jobId) {
    let position = 0
    for (const [id, job] of this.jobMap.entries()) {
      if (job.status !== 'queued') continue
      position += 1
      if (id === jobId) return position
    }
    return null
  }
}

class RedisJobStore {
  jobKey(jobId) {
    return `${JOB_KEY_PREFIX}${jobId}`
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
    await this.command(['SET', this.jobKey(jobId), JSON.stringify(job), 'EX', `${JOB_TTL_SECONDS}`])
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
    await this.pipeline([
      ['DEL', this.jobKey(jobId)],
      ['LREM', QUEUE_KEY, '0', jobId],
      ['SREM', PROCESSING_KEY, jobId],
    ])
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

  async getQueuePosition(jobId) {
    const queue = await this.command(['LRANGE', QUEUE_KEY, '0', '-1'])
    if (!Array.isArray(queue)) return null
    const position = queue.indexOf(jobId)
    return position === -1 ? null : position + 1
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
