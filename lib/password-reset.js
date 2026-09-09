import { createHash, randomBytes } from 'node:crypto'
import { isRedisConfigured, redisCommand } from './redis-client.js'

const RESET_TTL_SECONDS = 60 * 60
const RESET_KEY_PREFIX = 'audit:password-reset:'

const globalState = globalThis.__auditResetState ?? {
  tokens: new Map(),
}

globalThis.__auditResetState = globalState

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function resetKey(tokenHash) {
  return `${RESET_KEY_PREFIX}${tokenHash}`
}

function createResetTokenValue() {
  return randomBytes(32).toString('base64url')
}

async function storeResetToken(userId, token) {
  const tokenHash = hashToken(token)
  const record = {
    userId,
    expiresAt: Date.now() + RESET_TTL_SECONDS * 1000,
  }

  if (isRedisConfigured()) {
    await redisCommand(['SET', resetKey(tokenHash), JSON.stringify(record), 'EX', String(RESET_TTL_SECONDS)])
    return
  }

  globalState.tokens.set(tokenHash, record)
}

async function consumeResetToken(token) {
  if (typeof token !== 'string' || !token.trim()) return null
  const tokenHash = hashToken(token.trim())

  let record = null
  if (isRedisConfigured()) {
    const raw = await redisCommand(['GET', resetKey(tokenHash)])
    if (raw) {
      try {
        record = JSON.parse(raw)
      } catch {
        record = null
      }
    }
    await redisCommand(['DEL', resetKey(tokenHash)])
  } else {
    record = globalState.tokens.get(tokenHash) ?? null
    globalState.tokens.delete(tokenHash)
  }

  if (!record?.userId || record.expiresAt < Date.now()) {
    return null
  }

  return record.userId
}

export { RESET_TTL_SECONDS, consumeResetToken, createResetTokenValue, storeResetToken }
