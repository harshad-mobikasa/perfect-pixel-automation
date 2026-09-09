const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLES = new Set(['admin', 'member'])

function asNonEmptyString(value, label, maxLength = 80) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`)
  }

  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters`)
  }

  return trimmed
}

function normalizeEmail(value) {
  const email = asNonEmptyString(value, 'Email', 254).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('Enter a valid email address')
  }

  return email
}

function asRole(value) {
  if (!ROLES.has(value)) {
    throw new Error('Role must be admin or member')
  }

  return value
}

function asIdList(value, label) {
  if (value == null) return []
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`)
  }

  const unique = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`${label} contains an invalid id`)
    }
    unique.add(entry.trim())
  }

  return [...unique]
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeProjectConfig(rawConfig) {
  const config = isPlainObject(rawConfig) ? rawConfig : {}
  const pages = Array.isArray(config.pages) ? config.pages : []
  const typographyBlocks = Array.isArray(config.typographyBlocks) ? config.typographyBlocks : []
  const viewportConfig = isPlainObject(config.viewportConfig) ? config.viewportConfig : {}

  return {
    url: typeof config.url === 'string' ? config.url.trim() : '',
    pages: pages.slice(0, 50).map((page) => {
      const item = isPlainObject(page) ? page : {}
      const components = Array.isArray(item.components) ? item.components : []
      return {
        name: typeof item.name === 'string' ? item.name.slice(0, 80) : '',
        url: typeof item.url === 'string' ? item.url.slice(0, 500) : '',
        hideSelectors: typeof item.hideSelectors === 'string' ? item.hideSelectors.slice(0, 2000) : '',
        hideFixed: Boolean(item.hideFixed),
        components: components.slice(0, 50).map((component) => {
          const entry = isPlainObject(component) ? component : {}
          return {
            name: typeof entry.name === 'string' ? entry.name.slice(0, 80) : '',
            selector: typeof entry.selector === 'string' ? entry.selector.slice(0, 300) : '',
          }
        }),
      }
    }),
    viewportConfig: {
      desktop: {
        width: String(viewportConfig.desktop?.width ?? '1440').slice(0, 6),
        height: String(viewportConfig.desktop?.height ?? '956').slice(0, 6),
      },
      mobile: {
        width: String(viewportConfig.mobile?.width ?? '390').slice(0, 6),
        height: String(viewportConfig.mobile?.height ?? '844').slice(0, 6),
      },
    },
    typographyBlocks: typographyBlocks.slice(0, 20).map((block) => {
      const item = isPlainObject(block) ? block : {}
      return {
        name: typeof item.name === 'string' ? item.name.slice(0, 40) : '',
        value: isPlainObject(item.value) ? item.value : {},
      }
    }),
  }
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    projectIds: Array.isArray(user.projectIds) ? user.projectIds : [],
  }
}

function publicProject(project) {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    memberIds: Array.isArray(project.memberIds) ? project.memberIds : [],
    config: sanitizeProjectConfig(project.config),
  }
}

export {
  asIdList,
  asNonEmptyString,
  asRole,
  normalizeEmail,
  publicProject,
  publicUser,
  sanitizeProjectConfig,
}
