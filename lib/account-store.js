import { randomUUID } from 'node:crypto'
import { isRedisConfigured, isVercelRuntime } from './runtime-config.js'
import { redisCommand } from './redis-client.js'
import { hashPassword } from './password.js'
import {
  asIdList,
  asNonEmptyString,
  asRole,
  normalizeEmail,
  publicProject,
  publicUser,
  sanitizeProjectConfig,
} from './account-validation.js'

const USERS_KEY = 'audit:users'
const USER_EMAIL_KEY = 'audit:user-emails'
const PROJECTS_KEY = 'audit:projects'

const globalState = globalThis.__auditAccountState ?? {
  users: new Map(),
  emails: new Map(),
  projects: new Map(),
}

globalThis.__auditAccountState = globalState

function now() {
  return Date.now()
}

function parseJson(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

class MemoryAccountStore {
  constructor(state) {
    this.users = state.users
    this.emails = state.emails
    this.projects = state.projects
  }

  async listUsers() {
    return [...this.users.values()].map((user) => structuredClone(user))
  }

  async getUserById(userId) {
    const user = this.users.get(userId)
    return user ? structuredClone(user) : null
  }

  async getUserByEmail(email) {
    const userId = this.emails.get(email)
    return userId ? this.getUserById(userId) : null
  }

  async saveUser(user) {
    const previous = this.users.get(user.id)
    if (previous && previous.email !== user.email) {
      this.emails.delete(previous.email)
    }
    this.users.set(user.id, structuredClone(user))
    this.emails.set(user.email, user.id)
    return structuredClone(user)
  }

  async deleteUser(userId) {
    const user = this.users.get(userId)
    if (!user) return
    this.users.delete(userId)
    this.emails.delete(user.email)
  }

  async listProjects() {
    return [...this.projects.values()].map((project) => structuredClone(project))
  }

  async getProjectById(projectId) {
    const project = this.projects.get(projectId)
    return project ? structuredClone(project) : null
  }

  async saveProject(project) {
    this.projects.set(project.id, structuredClone(project))
    return structuredClone(project)
  }

  async deleteProject(projectId) {
    this.projects.delete(projectId)
  }
}

class RedisAccountStore {
  async listUsers() {
    const hash = await redisCommand(['HGETALL', USERS_KEY])
    return hashToObjects(hash)
  }

  async getUserById(userId) {
    return parseJson(await redisCommand(['HGET', USERS_KEY, userId]))
  }

  async getUserByEmail(email) {
    const userId = await redisCommand(['HGET', USER_EMAIL_KEY, email])
    return userId ? this.getUserById(userId) : null
  }

  async saveUser(user) {
    const previous = await this.getUserById(user.id)
    if (previous && previous.email !== user.email) {
      await redisCommand(['HDEL', USER_EMAIL_KEY, previous.email])
    }
    await redisCommand(['HSET', USERS_KEY, user.id, JSON.stringify(user)])
    await redisCommand(['HSET', USER_EMAIL_KEY, user.email, user.id])
    return user
  }

  async deleteUser(userId) {
    const user = await this.getUserById(userId)
    if (!user) return
    await redisCommand(['HDEL', USERS_KEY, userId])
    await redisCommand(['HDEL', USER_EMAIL_KEY, user.email])
  }

  async listProjects() {
    const hash = await redisCommand(['HGETALL', PROJECTS_KEY])
    return hashToObjects(hash)
  }

  async getProjectById(projectId) {
    return parseJson(await redisCommand(['HGET', PROJECTS_KEY, projectId]))
  }

  async saveProject(project) {
    await redisCommand(['HSET', PROJECTS_KEY, project.id, JSON.stringify(project)])
    return project
  }

  async deleteProject(projectId) {
    await redisCommand(['HDEL', PROJECTS_KEY, projectId])
  }
}

function hashToObjects(hash) {
  if (!hash) return []
  if (Array.isArray(hash)) {
    const result = []
    for (let index = 0; index < hash.length; index += 2) {
      const parsed = parseJson(hash[index + 1])
      if (parsed) result.push(parsed)
    }
    return result
  }

  return Object.values(hash)
    .map((value) => parseJson(value))
    .filter(Boolean)
}

function getAccountStore() {
  return isRedisConfigured() ? new RedisAccountStore() : new MemoryAccountStore(globalState)
}

async function ensureBootstrapAdmin(store = getAccountStore()) {
  if (isVercelRuntime() && !isRedisConfigured()) {
    const error = new Error(
      'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel for Production and Preview, then redeploy',
    )
    error.code = 'SETUP_REQUIRED'
    throw error
  }

  const users = await store.listUsers()
  if (users.length > 0) return

  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    const error = new Error(
      isVercelRuntime()
        ? 'Set ADMIN_EMAIL and ADMIN_PASSWORD in Vercel for Production and Preview, then redeploy'
        : 'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env to create the first admin account',
    )
    error.code = 'SETUP_REQUIRED'
    throw error
  }

  await createUserRecord(store, {
    email,
    password,
    name: 'Mobikasa Admin',
    role: 'admin',
    projectIds: [],
  })
}

async function createUserRecord(store, input) {
  const email = normalizeEmail(input.email)
  const existing = await store.getUserByEmail(email)
  if (existing) {
    throw new Error('A user with this email already exists')
  }

  const user = {
    id: randomUUID(),
    email,
    name: asNonEmptyString(input.name, 'Name'),
    role: asRole(input.role),
    projectIds: asIdList(input.projectIds, 'projectIds'),
    passwordHash: await hashPassword(input.password),
    createdAt: now(),
    updatedAt: now(),
  }

  await store.saveUser(user)
  await syncProjectMembership(store, user.id, user.projectIds, [])
  return user
}

async function syncProjectMembership(store, userId, nextProjectIds, previousProjectIds) {
  const previous = new Set(previousProjectIds)
  const next = new Set(nextProjectIds)

  for (const projectId of next) {
    const project = await store.getProjectById(projectId)
    if (!project) {
      throw new Error('One or more assigned projects were not found')
    }
    const memberIds = new Set(project.memberIds ?? [])
    memberIds.add(userId)
    await store.saveProject({
      ...project,
      memberIds: [...memberIds],
      updatedAt: now(),
    })
  }

  for (const projectId of previous) {
    if (next.has(projectId)) continue
    const project = await store.getProjectById(projectId)
    if (!project) continue
    await store.saveProject({
      ...project,
      memberIds: (project.memberIds ?? []).filter((id) => id !== userId),
      updatedAt: now(),
    })
  }
}

async function syncUserMembership(store, projectId, nextMemberIds, previousMemberIds) {
  const previous = new Set(previousMemberIds)
  const next = new Set(nextMemberIds)

  for (const userId of next) {
    const user = await store.getUserById(userId)
    if (!user) {
      throw new Error('One or more assigned users were not found')
    }
    if (user.role === 'admin') continue
    const projectIds = new Set(user.projectIds ?? [])
    projectIds.add(projectId)
    await store.saveUser({
      ...user,
      projectIds: [...projectIds],
      updatedAt: now(),
    })
  }

  for (const userId of previous) {
    if (next.has(userId)) continue
    const user = await store.getUserById(userId)
    if (!user) continue
    await store.saveUser({
      ...user,
      projectIds: (user.projectIds ?? []).filter((id) => id !== projectId),
      updatedAt: now(),
    })
  }
}

function canAccessProject(user, project) {
  if (!user || !project) return false
  if (user.role === 'admin') return true
  return (project.memberIds ?? []).includes(user.id) || (user.projectIds ?? []).includes(project.id)
}

async function canAccessJob(user, job) {
  if (!user || !job) return false
  if (user.role === 'admin') return true
  if (job.userId && job.userId === user.id) return true
  if (!job.projectId) return false
  const store = getAccountStore()
  const project = await store.getProjectById(job.projectId)
  return canAccessProject(user, project)
}

async function listAccessibleProjects(user) {
  const store = getAccountStore()
  const projects = await store.listProjects()
  return projects.filter((project) => canAccessProject(user, project)).map(publicProject)
}

async function createProject(actor, input) {
  if (actor.role !== 'admin') {
    throw new Error('Only admins can create projects')
  }

  const store = getAccountStore()
  const memberIds = asIdList(input.memberIds, 'memberIds')
  const project = {
    id: randomUUID(),
    name: asNonEmptyString(input.name, 'Project name'),
    memberIds,
    config: sanitizeProjectConfig(input.config),
    createdAt: now(),
    updatedAt: now(),
    createdBy: actor.id,
  }

  await store.saveProject(project)
  await syncUserMembership(store, project.id, memberIds, [])
  return publicProject(project)
}

async function updateProject(actor, projectId, patch) {
  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project || !canAccessProject(actor, project)) {
    return null
  }

  const next = { ...project, updatedAt: now() }

  if (patch.name != null) {
    if (actor.role !== 'admin') {
      throw new Error('Only admins can rename projects')
    }
    next.name = asNonEmptyString(patch.name, 'Project name')
  }

  if (patch.config != null) {
    next.config = sanitizeProjectConfig(patch.config)
  }

  if (patch.memberIds != null) {
    if (actor.role !== 'admin') {
      throw new Error('Only admins can assign project members')
    }
    const memberIds = asIdList(patch.memberIds, 'memberIds')
    await syncUserMembership(store, project.id, memberIds, project.memberIds ?? [])
    next.memberIds = memberIds
  }

  await store.saveProject(next)
  return publicProject(next)
}

async function deleteProject(actor, projectId) {
  if (actor.role !== 'admin') {
    throw new Error('Only admins can delete projects')
  }

  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project) return false
  await syncUserMembership(store, project.id, [], project.memberIds ?? [])
  await store.deleteProject(projectId)
  return true
}

async function updateUser(actor, userId, patch) {
  if (actor.role !== 'admin') {
    throw new Error('Only admins can update users')
  }

  const store = getAccountStore()
  const user = await store.getUserById(userId)
  if (!user) return null

  const next = { ...user, updatedAt: now() }

  if (patch.name != null) {
    next.name = asNonEmptyString(patch.name, 'Name')
  }

  if (patch.role != null) {
    next.role = asRole(patch.role)
    if (user.role === 'admin' && next.role !== 'admin') {
      const admins = (await store.listUsers()).filter((entry) => entry.role === 'admin')
      if (admins.length <= 1) {
        throw new Error('Keep at least one admin account')
      }
    }
  }

  if (patch.password) {
    next.passwordHash = await hashPassword(patch.password)
  }

  if (patch.projectIds != null) {
    const projectIds = asIdList(patch.projectIds, 'projectIds')
    await syncProjectMembership(store, user.id, projectIds, user.projectIds ?? [])
    next.projectIds = projectIds
  }

  await store.saveUser(next)
  return publicUser(next)
}

async function removeUser(actor, userId) {
  if (actor.role !== 'admin') {
    throw new Error('Only admins can delete users')
  }
  if (actor.id === userId) {
    throw new Error('You cannot delete your own account')
  }

  const store = getAccountStore()
  const user = await store.getUserById(userId)
  if (!user) return false

  if (user.role === 'admin') {
    const admins = (await store.listUsers()).filter((entry) => entry.role === 'admin')
    if (admins.length <= 1) {
      throw new Error('Keep at least one admin account')
    }
  }

  await syncProjectMembership(store, user.id, [], user.projectIds ?? [])
  await store.deleteUser(userId)
  return true
}

export {
  canAccessJob,
  canAccessProject,
  createProject,
  createUserRecord,
  deleteProject,
  ensureBootstrapAdmin,
  getAccountStore,
  listAccessibleProjects,
  publicProject,
  publicUser,
  removeUser,
  updateProject,
  updateUser,
}
