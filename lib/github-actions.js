const DEFAULT_DISPATCH_EVENT = 'audit-queued'

function getRepository() {
  const repository = process.env.GITHUB_REPOSITORY
  if (repository?.includes('/')) return repository

  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  if (owner && repo) return `${owner}/${repo}`

  return null
}

function getToken() {
  return process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_TOKEN || null
}

async function triggerGitHubAuditWorker(jobId) {
  const repository = getRepository()
  const token = getToken()

  if (!repository || !token) {
    return {
      status: 'skipped',
      reason: 'GitHub worker trigger is not configured',
    }
  }

  const eventType = process.env.GITHUB_DISPATCH_EVENT || DEFAULT_DISPATCH_EVENT
  const response = await fetch(`https://api.github.com/repos/${repository}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: { jobId },
    }),
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    return {
      status: 'failed',
      reason: `GitHub dispatch failed with status ${response.status}${message ? `: ${message}` : ''}`,
    }
  }

  return {
    status: 'triggered',
    eventType,
    repository,
  }
}

export { triggerGitHubAuditWorker }
