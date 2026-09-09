import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const KEY_LENGTH = 64

function asPassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
    throw new Error('Password must be between 10 and 128 characters')
  }

  return value
}

async function hashPassword(password) {
  const normalized = asPassword(password)
  const salt = randomBytes(16)
  const derived = await scryptAsync(normalized, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`
}

async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false
  }

  const parts = storedHash.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false
  }

  try {
    const salt = Buffer.from(parts[1], 'base64url')
    const expected = Buffer.from(parts[2], 'base64url')
    if (expected.length === 0) return false
    const derived = await scryptAsync(password, salt, expected.length)
    return timingSafeEqual(expected, derived)
  } catch {
    return false
  }
}

export { asPassword, hashPassword, verifyPassword }
