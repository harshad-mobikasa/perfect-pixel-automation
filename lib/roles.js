const ROLE = {
  ADMIN: 'admin',
  USER: 'user',
  PROJECT_ADMIN: 'project_admin',
  DEV: 'dev',
}

const ROLE_LABELS = {
  [ROLE.ADMIN]: 'Admin',
  [ROLE.USER]: 'User',
  [ROLE.PROJECT_ADMIN]: 'Project admin',
  [ROLE.DEV]: 'Dev',
}

const RETENTION_OPTIONS = [7, 14, 30, 60, 90]

function normalizePlatformRole(role) {
  return role === ROLE.ADMIN ? ROLE.ADMIN : ROLE.USER
}

function normalizeProjectRole(role) {
  if (role === 'member' || role === ROLE.USER) return ROLE.DEV
  if (role === ROLE.PROJECT_ADMIN) return ROLE.PROJECT_ADMIN
  return ROLE.DEV
}

function normalizeRole(role) {
  if (role === ROLE.ADMIN) return ROLE.ADMIN
  if (role === ROLE.PROJECT_ADMIN) return ROLE.PROJECT_ADMIN
  if (role === 'member') return ROLE.DEV
  if (role === ROLE.USER) return ROLE.USER
  return ROLE.DEV
}

function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] ?? 'Dev'
}

function isAdmin(user) {
  return normalizePlatformRole(user?.role) === ROLE.ADMIN
}

function getProjectMembers(project) {
  if (!project) return []
  if (Array.isArray(project.members) && project.members.length > 0) {
    return project.members.map((member) => ({
      userId: member.userId,
      role: normalizeProjectRole(member.role),
    }))
  }

  return (project.memberIds ?? []).map((userId) => ({
    userId,
    role: ROLE.DEV,
  }))
}

function getProjectRole(user, project) {
  if (!user || !project) return null
  if (isAdmin(user)) return ROLE.ADMIN
  const member = getProjectMembers(project).find((entry) => entry.userId === user.id)
  if (member) return member.role
  const stored = user.projectRoles?.[project.id]
  if (stored) return normalizeProjectRole(stored)
  if ((user.projectIds ?? []).includes(project.id)) {
    return user.role === ROLE.PROJECT_ADMIN ? ROLE.PROJECT_ADMIN : ROLE.DEV
  }
  return null
}

function canAccessProject(user, project) {
  return getProjectRole(user, project) != null
}

function canManageProject(user, project) {
  const role = getProjectRole(user, project)
  return role === ROLE.ADMIN || role === ROLE.PROJECT_ADMIN
}

function isProjectAdminAnywhere(user) {
  if (isAdmin(user)) return true
  if (user?.role === ROLE.PROJECT_ADMIN) return true
  return Object.values(user?.projectRoles ?? {}).some((role) => normalizeProjectRole(role) === ROLE.PROJECT_ADMIN)
}

function canManageUsers(user) {
  return isAdmin(user) || isProjectAdminAnywhere(user)
}

function canIssueResetLink(actor, target) {
  if (!actor || !target || actor.id === target.id) return false
  if (isAdmin(actor)) return true
  if (isAdmin(target)) return false
  const targetProjects = new Set(target.projectIds ?? [])
  return Object.entries(actor.projectRoles ?? {}).some(
    ([projectId, role]) =>
      normalizeProjectRole(role) === ROLE.PROJECT_ADMIN && targetProjects.has(projectId),
  )
}

function actorManagedProjectIds(user, projects) {
  if (Array.isArray(projects) && projects.length > 0) {
    return new Set(projects.filter((project) => canManageProject(user, project)).map((project) => project.id))
  }

  return new Set(
    Object.entries(user?.projectRoles ?? {})
      .filter(([, role]) => normalizeProjectRole(role) === ROLE.PROJECT_ADMIN)
      .map(([projectId]) => projectId),
  )
}

function clampRetentionDays(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return 30
  if (RETENTION_OPTIONS.includes(parsed)) return parsed
  return Math.min(90, Math.max(7, parsed))
}

export {
  RETENTION_OPTIONS,
  ROLE,
  ROLE_LABELS,
  actorManagedProjectIds,
  canAccessProject,
  canIssueResetLink,
  canManageProject,
  canManageUsers,
  clampRetentionDays,
  getProjectMembers,
  getProjectRole,
  isAdmin,
  isProjectAdminAnywhere,
  normalizePlatformRole,
  normalizeProjectRole,
  normalizeRole,
  roleLabel,
}
