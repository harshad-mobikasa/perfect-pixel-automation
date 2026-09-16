import { getRedisRestConfig, isRedisConfigured } from './runtime-config.js'

async function redisCommand(command) {
  const { url, token } = getRedisRestConfig()
  if (!url || !token) {
    throw new Error('Redis is not configured')
  }

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

async function redisPipeline(commands) {
  const { url, token } = getRedisRestConfig()
  if (!url || !token) {
    throw new Error('Redis is not configured')
  }

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
  if (!Array.isArray(payload)) {
    throw new Error('Redis pipeline returned an unexpected payload')
  }

  return payload.map((entry) => {
    if (entry?.error) {
      throw new Error(entry.error)
    }
    return entry?.result ?? null
  })
}

export { isRedisConfigured, redisCommand, redisPipeline }
