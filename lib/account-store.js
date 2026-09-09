import { randomUUID } from 'node:crypto'
import { isRedisConfigured, isVercelRuntime } from './runtime-config.js'
import { redisCommand } from './redis-client.js'
import { hashPassword } from './password.js'
import { createResetTokenValue, storeResetToken } from './password-reset.js'
import {
  ROLE,
  canAccessProject,
  canManageProject,
  canManageUsers,
  clampRetentionDays,
  getProjectMembers,
  isAdmin,
  normalizePlatformRole,
  normalizeProjectRole,
} from './roles.js'
import {
  asIdList,
  asNonEmptyString,
  asProjectRole,
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
      'Redis is not available on this Vercel deploy. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN) for Production and Preview, then redeploy.',
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
    role: normalizePlatformRole(asRole(input.role ?? ROLE.USER)),
    projectIds: asIdList(input.projectIds, 'projectIds'),
    projectRoles: {},
    passwordHash: await hashPassword(input.password),
    createdAt: now(),
    updatedAt: now(),
  }

  await store.saveUser(user)
  if (user.projectIds.length > 0) {
    const projectRole = asProjectRole(input.projectRole ?? input.role ?? ROLE.DEV)
    for (const projectId of user.projectIds) {
      await setProjectMemberRole(store, projectId, user.id, projectRole)
    }
  }
  return user
}

async function setProjectMemberRole(store, projectId, userId, projectRole) {
  const project = await store.getProjectById(projectId)
  if (!project) {
    throw new Error('Project not found')
  }

  const members = getProjectMembers(project).filter((member) => member.userId !== userId)
  members.push({ userId, role: asProjectRole(projectRole) })
  await store.saveProject({
    ...project,
    members,
    memberIds: members.map((member) => member.userId),
    updatedAt: now(),
  })

  const user = await store.getUserById(userId)
  if (!user || isAdmin(user)) return

  const projectIds = [...new Set([...(user.projectIds ?? []), projectId])]
  const projectRoles = { ...(user.projectRoles ?? {}), [projectId]: asProjectRole(projectRole) }
  await store.saveUser({
    ...user,
    projectIds,
    projectRoles,
    updatedAt: now(),
  })
}

async function clearProjectMember(store, projectId, userId) {
  const project = await store.getProjectById(projectId)
  if (!project) return
  const members = getProjectMembers(project).filter((member) => member.userId !== userId)
  await store.saveProject({
    ...project,
    members,
    memberIds: members.map((member) => member.userId),
    updatedAt: now(),
  })

  const user = await store.getUserById(userId)
  if (!user) return
  const projectRoles = { ...(user.projectRoles ?? {}) }
  delete projectRoles[projectId]
  await store.saveUser({
    ...user,
    projectIds: (user.projectIds ?? []).filter((id) => id !== projectId),
    projectRoles,
    updatedAt: now(),
  })
}

async function syncProjectMembership(store, userId, nextProjectIds, previousProjectIds) {
  const previous = new Set(previousProjectIds)
  const next = new Set(nextProjectIds)

  for (const projectId of next) {
    if (previous.has(projectId)) continue
    await setProjectMemberRole(store, projectId, userId, ROLE.DEV)
  }

  for (const projectId of previous) {
    if (next.has(projectId)) continue
    await clearProjectMember(store, projectId, userId)
  }
}

async function syncUserMembership(store, projectId, nextMemberIds, previousMemberIds) {
  const previous = new Set(previousMemberIds)
  const next = new Set(nextMemberIds)

  for (const userId of next) {
    if (previous.has(userId)) continue
    const user = await store.getUserById(userId)
    if (!user) {
      throw new Error('One or more assigned users were not found')
    }
    if (isAdmin(user)) continue
    await setProjectMemberRole(store, projectId, userId, ROLE.DEV)
  }

  for (const userId of previous) {
    if (next.has(userId)) continue
    await clearProjectMember(store, projectId, userId)
  }
}

function withNormalizedRole(user) {
  if (!user) return null
  return {
    ...user,
    role: normalizePlatformRole(user.role),
    projectRoles: user.projectRoles ?? {},
  }
}

async function listVisibleUsers(actor) {
  const store = getAccountStore()
  const users = (await store.listUsers()).map(withNormalizedRole)
  const projects = await store.listProjects()
  if (isAdmin(actor)) {
    return users.map(publicUser)
  }

  const managedIds = new Set(
    projects.filter((project) => canManageProject(actor, project)).map((project) => project.id),
  )

  return users
    .filter((user) => (user.projectIds ?? []).some((projectId) => managedIds.has(projectId)))
    .map(publicUser)
}

async function createInvitedUser(actor, input) {
  if (!canManageUsers(actor)) {
    throw new Error('You cannot invite users')
  }

  const requestedRole = asRole(input.role ?? ROLE.DEV)
  const requestedProjects = asIdList(input.projectIds, 'projectIds')
  const store = getAccountStore()
  const actorProjects = await store.listProjects()

  if (!isAdmin(actor)) {
    if (requestedRole === ROLE.ADMIN) {
      throw new Error('Project admins cannot invite platform admins')
    }
    const allowed = new Set(
      actorProjects.filter((project) => canManageProject(actor, project)).map((project) => project.id),
    )
    if (requestedProjects.length === 0 || requestedProjects.some((projectId) => !allowed.has(projectId))) {
      throw new Error('You can only invite people onto projects you admin')
    }
  }

  if (requestedRole === ROLE.ADMIN) {
    const user = await createUserRecord(store, {
      ...input,
      role: ROLE.ADMIN,
      projectIds: [],
    })
    return publicUser(user)
  }

  const user = await createUserRecord(store, {
    ...input,
    role: ROLE.USER,
    projectIds: [],
  })

  const projectRole = asProjectRole(requestedRole === ROLE.PROJECT_ADMIN ? ROLE.PROJECT_ADMIN : ROLE.DEV)
  for (const projectId of requestedProjects) {
    await setProjectMemberRole(store, projectId, user.id, projectRole)
  }

  return publicUser(await store.getUserById(user.id))
}

async function inviteProjectMember(actor, projectId, input) {
  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project || !canManageProject(actor, project)) {
    throw new Error('You cannot invite people to this project')
  }

  const projectRole = asProjectRole(input.role ?? ROLE.DEV)
  const email = normalizeEmail(input.email)
  let user = await store.getUserByEmail(email)
  let created = false

  if (!user) {
    user = await createUserRecord(store, {
      email,
      name: input.name,
      password: input.password,
      role: ROLE.USER,
      projectIds: [],
    })
    created = true
  } else if (isAdmin(user)) {
    throw new Error('Platform admins already have access to every project')
  }

  await setProjectMemberRole(store, projectId, user.id, projectRole)
  const saved = await store.getUserById(user.id)
  return { user: publicUser(saved), created }
}

async function updateProjectMemberRole(actor, projectId, userId, role) {
  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project || !canManageProject(actor, project)) {
    throw new Error('You cannot change roles on this project')
  }

  const target = await store.getUserById(userId)
  if (!target || isAdmin(target)) {
    throw new Error('User not found on this project')
  }

  if (!getProjectMembers(project).some((member) => member.userId === userId)) {
    throw new Error('User is not a member of this project')
  }

  await setProjectMemberRole(store, projectId, userId, asProjectRole(role))
  return publicUser(await store.getUserById(userId))
}

async function removeProjectMember(actor, projectId, userId) {
  if (actor.id === userId) {
    throw new Error('You cannot remove yourself from the project')
  }

  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project || !canManageProject(actor, project)) {
    throw new Error('You cannot remove people from this project')
  }

  const target = await store.getUserById(userId)
  if (!target) return false
  await clearProjectMember(store, projectId, userId)
  return true
}

async function listProjectMembers(actor, projectId) {
  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project || !canAccessProject(actor, project)) {
    return null
  }

  const members = []
  for (const member of getProjectMembers(project)) {
    const user = await store.getUserById(member.userId)
    if (!user) continue
    members.push({
      ...publicUser(user),
      projectRole: member.role,
    })
  }
  return members
}

async function canAccessJob(user, job) {
  if (!user || !job) return false
  if (isAdmin(user)) return true
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
  if (!isAdmin(actor)) {
    throw new Error('Only admins can create projects')
  }

  const store = getAccountStore()
  const memberIds = asIdList(input.memberIds, 'memberIds')
  const project = {
    id: randomUUID(),
    name: asNonEmptyString(input.name, 'Project name'),
    members: [],
    memberIds: [],
    retentionDays: clampRetentionDays(input.retentionDays),
    config: sanitizeProjectConfig(input.config),
    createdAt: now(),
    updatedAt: now(),
    createdBy: actor.id,
  }

  await store.saveProject(project)
  await syncUserMembership(store, project.id, memberIds, [])
  return publicProject(await store.getProjectById(project.id))
}

async function updateProject(actor, projectId, patch) {
  const store = getAccountStore()
  const project = await store.getProjectById(projectId)
  if (!project || !canAccessProject(actor, project)) {
    return null
  }

  const next = { ...project, updatedAt: now() }

  if (patch.name != null) {
    if (!isAdmin(actor)) {
      throw new Error('Only admins can rename projects')
    }
    next.name = asNonEmptyString(patch.name, 'Project name')
  }

  if (patch.config != null) {
    next.config = sanitizeProjectConfig(patch.config)
  }

  if (patch.retentionDays != null) {
    if (!canManageProject(actor, project)) {
      throw new Error('Only project admins can change report retention')
    }
    next.retentionDays = clampRetentionDays(patch.retentionDays)
  }

  if (patch.memberIds != null) {
    if (!canManageProject(actor, project)) {
      throw new Error('Only project admins can assign project members')
    }
    const memberIds = asIdList(patch.memberIds, 'memberIds')
    await syncUserMembership(store, project.id, memberIds, getProjectMembers(project).map((member) => member.userId))
    next.members = memberIds.map((userId) => {
      const existing = getProjectMembers(project).find((member) => member.userId === userId)
      return { userId, role: existing?.role ?? ROLE.DEV }
    })
    next.memberIds = memberIds
  }

  await store.saveProject(next)
  return publicProject(next)
}

async function deleteProject(actor, projectId) {
  if (!isAdmin(actor)) {
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
  if (!isAdmin(actor)) {
    throw new Error('Only admins can update user accounts')
  }

  const store = getAccountStore()
  const user = withNormalizedRole(await store.getUserById(userId))
  if (!user) return null

  const next = { ...user, updatedAt: now() }

  if (patch.name != null) {
    next.name = asNonEmptyString(patch.name, 'Name')
  }

  if (patch.role != null) {
    next.role = normalizePlatformRole(asRole(patch.role))
    if (user.role === ROLE.ADMIN && next.role !== ROLE.ADMIN) {
      const admins = (await store.listUsers()).filter((entry) => normalizePlatformRole(entry.role) === ROLE.ADMIN)
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
  if (!isAdmin(actor)) {
    throw new Error('Only admins can delete user accounts')
  }
  if (actor.id === userId) {
    throw new Error('You cannot delete your own account')
  }

  const store = getAccountStore()
  const user = withNormalizedRole(await store.getUserById(userId))
  if (!user) return false

  if (user.role === ROLE.ADMIN) {
    const admins = (await store.listUsers()).filter((entry) => normalizePlatformRole(entry.role) === ROLE.ADMIN)
    if (admins.length <= 1) {
      throw new Error('Keep at least one admin account')
    }
  }

  await syncProjectMembership(store, user.id, [], user.projectIds ?? [])
  await store.deleteUser(userId)
  return true
}

async function setUserPasswordById(userId, password) {
  const store = getAccountStore()
  const user = await store.getUserById(userId)
  if (!user) return false
  await store.saveUser({
    ...user,
    passwordHash: await hashPassword(password),
    updatedAt: now(),
  })
  return true
}

async function createUserResetLink(actor, userId, origin) {
  if (!canManageUsers(actor)) {
    throw new Error('You cannot reset passwords')
  }

  const store = getAccountStore()
  const user = withNormalizedRole(await store.getUserById(userId))
  if (!user) return null

  if (!isAdmin(actor)) {
    const projects = await store.listProjects()
    const canReset = projects.some(
      (project) => canManageProject(actor, project) && canAccessProject(user, project),
    )
    if (!canReset) {
      throw new Error('You can only reset passwords for people on your projects')
    }
  }

  const token = createResetTokenValue()
  await storeResetToken(user.id, token)
  return `${origin}/reset-password?token=${encodeURIComponent(token)}`
}

export {
  canAccessJob,
  canAccessProject,
  createInvitedUser,
  createProject,
  createUserRecord,
  createUserResetLink,
  deleteProject,
  ensureBootstrapAdmin,
  getAccountStore,
  inviteProjectMember,
  listAccessibleProjects,
  listProjectMembers,
  listVisibleUsers,
  publicProject,
  publicUser,
  removeProjectMember,
  removeUser,
  updateProjectMemberRole,
  setUserPasswordById,
  updateProject,
  updateUser,
}
