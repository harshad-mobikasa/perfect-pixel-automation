function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isRedisConfigured() {
  return hasValue(process.env.UPSTASH_REDIS_REST_URL) && hasValue(process.env.UPSTASH_REDIS_REST_TOKEN)
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
  isRedisConfigured,
  isShopifyFilesConfigured,
  isSharedInfrastructureConfigured,
  isVercelRuntime,
  shouldUseSharedInfrastructure,
  shouldProcessAuditsInCurrentProcess,
}
