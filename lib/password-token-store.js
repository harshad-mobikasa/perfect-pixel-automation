import { createHash, randomBytes } from 'node:crypto'
import { isRedisConfigured, redisCommand } from './redis-client.js'

const TOKEN_KEY_PREFIX = 'audit:password-token:'
const TOKEN_PURPOSE = {
  INVITE: 'invite',
  PASSWORD_RESET: 'password_reset',
}
const INVITE_TOKEN_TTL_SECONDS = 24 * 60 * 60
const RESET_TOKEN_TTL_SECONDS = 60 * 60

const memoryTokens = globalThis.__auditPasswordTokens ?? new Map()
globalThis.__auditPasswordTokens = memoryTokens

function now() {
  return Date.now()
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('base64url')
}

function tokenKey(tokenHash) {
  return `${TOKEN_KEY_PREFIX}${tokenHash}`
}

function parseTokenRecord(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function tokenTtlForPurpose(purpose) {
  return purpose === TOKEN_PURPOSE.INVITE ? INVITE_TOKEN_TTL_SECONDS : RESET_TOKEN_TTL_SECONDS
}

function assertPurpose(purpose) {
  if (purpose !== TOKEN_PURPOSE.INVITE && purpose !== TOKEN_PURPOSE.PASSWORD_RESET) {
    throw new Error('Invalid token purpose')
  }
  return purpose
}

async function createPasswordToken({ userId, email, purpose }) {
  const normalizedPurpose = assertPurpose(purpose)
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const expiresInSeconds = tokenTtlForPurpose(normalizedPurpose)
  const record = {
    userId,
    email,
    purpose: normalizedPurpose,
    createdAt: now(),
    expiresAt: now() + expiresInSeconds * 1000,
  }

  if (isRedisConfigured()) {
    await redisCommand(['SET', tokenKey(tokenHash), JSON.stringify(record), 'EX', String(expiresInSeconds)])
  } else {
    memoryTokens.set(tokenHash, record)
  }

  return {
    token,
    expiresAt: record.expiresAt,
  }
}

async function consumePasswordToken(token, purpose = null) {
  const normalizedPurpose = purpose ? assertPurpose(purpose) : null
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    return null
  }

  const tokenHash = hashToken(token)
  let record
  if (isRedisConfigured()) {
    const raw = await redisCommand(['GET', tokenKey(tokenHash)])
    record = parseTokenRecord(raw)
  } else {
    record = memoryTokens.get(tokenHash) ?? null
  }

  if (!record || (normalizedPurpose && record.purpose !== normalizedPurpose) || record.expiresAt < now()) {
    if (record?.expiresAt < now()) {
      await deletePasswordTokenHash(tokenHash)
    }
    return null
  }

  await deletePasswordTokenHash(tokenHash)
  return record
}

async function deletePasswordTokenHash(tokenHash) {
  if (isRedisConfigured()) {
    await redisCommand(['DEL', tokenKey(tokenHash)])
    return
  }
  memoryTokens.delete(tokenHash)
}

export {
  INVITE_TOKEN_TTL_SECONDS,
  RESET_TOKEN_TTL_SECONDS,
  TOKEN_PURPOSE,
  consumePasswordToken,
  createPasswordToken,
}
