import { randomUUID } from 'node:crypto'
import { isRedisConfigured, redisCommand } from './redis-client.js'
import { isAdmin } from './roles.js'

const ACTIVITY_KEY_PREFIX = 'audit:activity:'
const ACTIVITY_INDEX_KEY = 'audit:activity-index'
const ACTIVITY_RETENTION_DAYS = 45
const ACTIVITY_RETENTION_MS = ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000

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

async function pruneActivity() {
  const cutoff = Date.now() - ACTIVITY_RETENTION_MS

  if (isRedisConfigured()) {
    const staleIds = await redisCommand(['ZRANGEBYSCORE', ACTIVITY_INDEX_KEY, '0', String(cutoff)])
    const ids = Array.isArray(staleIds) ? staleIds : []
    for (const id of ids) {
      await redisCommand(['DEL', `${ACTIVITY_KEY_PREFIX}${id}`])
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
      await redisCommand([
        'SET',
        `${ACTIVITY_KEY_PREFIX}${event.id}`,
        JSON.stringify(event),
        'EX',
        String(ACTIVITY_RETENTION_DAYS * 24 * 60 * 60),
      ])
      await redisCommand(['ZADD', ACTIVITY_INDEX_KEY, String(event.at), event.id])
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

async function listActivity(actor, managedProjectIds = new Set()) {
  await pruneActivity()
  let events = []

  if (isRedisConfigured()) {
    const ids = await redisCommand(['ZREVRANGE', ACTIVITY_INDEX_KEY, '0', '199'])
    for (const id of Array.isArray(ids) ? ids : []) {
      const event = parseJson(await redisCommand(['GET', `${ACTIVITY_KEY_PREFIX}${id}`]))
      if (event) events.push(event)
    }
  } else {
    events = [...globalState.events].sort((left, right) => right.at - left.at)
  }

  return events.filter((event) => canViewEvent(actor, event, managedProjectIds))
}

export { ACTIVITY_RETENTION_DAYS, listActivity, pruneActivity, recordActivity }
