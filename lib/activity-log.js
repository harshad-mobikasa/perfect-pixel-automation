import { randomUUID } from 'node:crypto'
import { isRedisConfigured, redisCommand, redisPipeline } from './redis-client.js'
import { isAdmin } from './roles.js'

const ACTIVITY_KEY_PREFIX = 'audit:activity:'
const ACTIVITY_INDEX_KEY = 'audit:activity-index'
const ACTIVITY_RETENTION_DAYS = 45
const ACTIVITY_RETENTION_MS = ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const globalState = globalThis.__auditActivityState ?? {
  events: [],
}

globalThis.__auditActivityState = globalState

function actorSnapshot(actor) {
  return {
    userId: actor?.id ?? actor?.userId ?? null,
    name: actor?.name ?? 'Unknown',
    email: actor?.email ?? '',
  }
}

function parseJson(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return null
  return value
}

function dayStartMs(dateKey) {
  return new Date(`${dateKey}T00:00:00`).getTime()
}

function dayEndMs(dateKey) {
  return new Date(`${dateKey}T23:59:59.999`).getTime()
}

function clampPage(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function clampPageSize(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return 20
  return Math.min(50, Math.max(10, parsed))
}

async function pruneActivity() {
  const cutoff = Date.now() - ACTIVITY_RETENTION_MS

  if (isRedisConfigured()) {
    const staleIds = await redisCommand(['ZRANGEBYSCORE', ACTIVITY_INDEX_KEY, '0', String(cutoff)])
    const ids = Array.isArray(staleIds) ? staleIds : []
    if (ids.length > 0) {
      await redisPipeline(ids.map((id) => ['DEL', `${ACTIVITY_KEY_PREFIX}${id}`]))
    }
    await redisCommand(['ZREMRANGEBYSCORE', ACTIVITY_INDEX_KEY, '0', String(cutoff)])
    return
  }

  globalState.events = globalState.events.filter((event) => event.at >= cutoff)
}

async function recordActivity(actor, action, details = {}) {
  try {
    await pruneActivity()
    const event = {
      id: randomUUID(),
      at: Date.now(),
      action,
      actor: actorSnapshot(actor),
      projectId: details.projectId ?? null,
      projectName: details.projectName ?? null,
      target: details.target ?? null,
      detail: details.detail ?? '',
    }

    if (isRedisConfigured()) {
      await redisPipeline([
        ['SET', `${ACTIVITY_KEY_PREFIX}${event.id}`, JSON.stringify(event), 'EX', String(ACTIVITY_RETENTION_DAYS * 24 * 60 * 60)],
        ['ZADD', ACTIVITY_INDEX_KEY, String(event.at), event.id],
      ])
      return
    }

    globalState.events = [event, ...globalState.events]
  } catch {
    // Logging must not block the original action.
  }
}

function canViewEvent(actor, event, managedProjectIds) {
  if (isAdmin(actor)) return true
  return Boolean(event.projectId && managedProjectIds.has(event.projectId))
}

async function loadEventsByIds(ids) {
  if (ids.length === 0) return []
  const values = await redisCommand(['MGET', ...ids.map((id) => `${ACTIVITY_KEY_PREFIX}${id}`)])
  return (Array.isArray(values) ? values : []).map(parseJson).filter(Boolean)
}

async function listActivity(actor, managedProjectIds = new Set(), options = {}) {
  const page = clampPage(options.page)
  const pageSize = clampPageSize(options.pageSize)
  const from = parseDateKey(options.from)
  const to = parseDateKey(options.to)
  const minScore = from ? dayStartMs(from) : Date.now() - ACTIVITY_RETENTION_MS
  const maxScore = to ? dayEndMs(to) : Date.now()
  const offset = (page - 1) * pageSize

  if (isRedisConfigured() && isAdmin(actor)) {
    const counted = await redisCommand(['ZCOUNT', ACTIVITY_INDEX_KEY, String(minScore), String(maxScore)])
    const total = Number(counted) || 0
    const ids = await redisCommand([
      'ZREVRANGEBYSCORE',
      ACTIVITY_INDEX_KEY,
      String(maxScore),
      String(minScore),
      'LIMIT',
      String(offset),
      String(pageSize),
    ])
    return {
      events: await loadEventsByIds(Array.isArray(ids) ? ids : []),
      total,
      page,
      pageSize,
      from: from ?? '',
      to: to ?? '',
      retentionDays: ACTIVITY_RETENTION_DAYS,
    }
  }

  let visible = []

  if (isRedisConfigured()) {
    const ids = await redisCommand([
      'ZREVRANGEBYSCORE',
      ACTIVITY_INDEX_KEY,
      String(maxScore),
      String(minScore),
      'LIMIT',
      '0',
      '500',
    ])
    const events = await loadEventsByIds(Array.isArray(ids) ? ids : [])
    visible = events.filter((event) => canViewEvent(actor, event, managedProjectIds))
  } else {
    visible = [...globalState.events]
      .filter((event) => event.at >= minScore && event.at <= maxScore)
      .filter((event) => canViewEvent(actor, event, managedProjectIds))
      .sort((left, right) => right.at - left.at)
  }

  const total = visible.length
  const events = visible.slice(offset, offset + pageSize)

  return {
    events,
    total,
    page,
    pageSize,
    from: from ?? '',
    to: to ?? '',
    retentionDays: ACTIVITY_RETENTION_DAYS,
  }
}

export { ACTIVITY_RETENTION_DAYS, listActivity, pruneActivity, recordActivity }
