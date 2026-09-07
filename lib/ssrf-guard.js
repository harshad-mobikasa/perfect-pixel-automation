import { lookup } from 'node:dns/promises'

const VALID_PROTOCOLS = new Set(['http:', 'https:'])
const VALID_SUITES = new Set(['pixelmatch', 'typography', 'seo', 'lighthouse', 'ada', 'responsive'])

export { VALID_SUITES }

export async function validateAuditRequest(rawUrl, suite) {
  if (!VALID_SUITES.has(suite)) {
    throw new Error(`Invalid suite. Must be one of: ${[...VALID_SUITES].join(', ')}`)
  }

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL')
  }

  if (!VALID_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('URL must use http or https')
  }

  const hostname = parsed.hostname

  let address
  try {
    const result = await lookup(hostname)
    address = result.address
  } catch {
    throw new Error('Could not resolve hostname')
  }

  if (isBlockedIp(address)) {
    throw new Error('URL resolves to a blocked or private IP address')
  }
}

function isBlockedIp(ip) {
  // Strip IPv6-mapped IPv4 prefix (::ffff:1.2.3.4)
  const addr = ip.startsWith('::ffff:') ? ip.slice(7) : ip

  const parts = addr.split('.').map(Number)
  if (parts.length === 4 && parts.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
    if (parts[0] === 0) return true                                           // 0.0.0.0/8
    if (parts[0] === 10) return true                                          // 10.0.0.0/8
    if (parts[0] === 127) return true                                         // 127.0.0.0/8 loopback
    if (parts[0] === 169 && parts[1] === 254) return true                     // 169.254.0.0/16 link-local
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true    // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true                     // 192.168.0.0/16
    return false
  }

  // IPv6
  const normalized = addr.toLowerCase()
  if (normalized === '::1') return true
  if (normalized === '::') return true
  if (normalized.startsWith('fe80:')) return true   // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true  // ULA
  return false
}
