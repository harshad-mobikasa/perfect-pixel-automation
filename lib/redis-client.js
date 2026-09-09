import { isRedisConfigured } from './runtime-config.js'

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
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

export { isRedisConfigured, redisCommand }
