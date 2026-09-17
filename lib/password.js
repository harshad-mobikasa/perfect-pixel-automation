import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const KEY_LENGTH = 64

function asPassword(value) {
  if (typeof value !== 'string' || value.length < 10) {
    throw new Error('Use at least 10 characters for your password')
  }
  if (value.length > 128) {
    throw new Error('Password is too long')
  }

  return value
}

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(16)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
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

export { asPassword, generateTemporaryPassword, hashPassword, verifyPassword }
