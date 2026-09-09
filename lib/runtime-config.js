function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function readEnv(names) {
  const env = process.env
  for (const name of names) {
    const value = env[name]
    if (hasValue(value)) {
      return value.trim()
    }
  }
  return ''
}

function getRedisRestConfig() {
  return {
    url: readEnv(['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'UPSTASH_KV_REST_API_URL']),
    token: readEnv(['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN', 'UPSTASH_KV_REST_API_TOKEN']),
  }
}

function isRedisConfigured() {
  const { url, token } = getRedisRestConfig()
  return hasValue(url) && hasValue(token)
}

function isShopifyFilesConfigured() {
  return hasValue(process.env.SHOPIFY_STORE_URL) && hasValue(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN)
}

function isSharedInfrastructureConfigured() {
  return isRedisConfigured() && isShopifyFilesConfigured()
}

function isVercelRuntime() {
  return hasValue(process.env.VERCEL)
}

function shouldUseSharedInfrastructure() {
  return isSharedInfrastructureConfigured()
}

function shouldProcessAuditsInCurrentProcess() {
  if (isVercelRuntime()) return false
  if (process.env.AUDIT_PROCESS_IN_API === 'false') return false
  return true
}

export {
  hasValue,
  getRedisRestConfig,
  isRedisConfigured,
  isShopifyFilesConfigured,
  isSharedInfrastructureConfigured,
  isVercelRuntime,
  shouldUseSharedInfrastructure,
  shouldProcessAuditsInCurrentProcess,
}
