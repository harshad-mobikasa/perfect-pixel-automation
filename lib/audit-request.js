const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024
const DEFAULT_VIEWPORT = {
  desktop: { width: 1440, height: 956 },
  mobile: { width: 390, height: 844 },
}

function asNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`)
  }

  return value.trim()
}

function normalizePageUrl(value) {
  const trimmed = asNonEmptyString(value, 'Page URL')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')) {
    return trimmed
  }

  return `/${trimmed}`
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function parseUploads(formData) {
  const uploads = {}

  for (const [key, value] of formData.entries()) {
    if (key === 'definition') continue
    if (!(value instanceof File)) {
      throw new Error(`Invalid upload for ${key}`)
    }

    if (!value.name.toLowerCase().endsWith('.png')) {
      throw new Error(`Uploaded file ${value.name} must be a PNG`)
    }

    if (value.size > MAX_UPLOAD_SIZE_BYTES) {
      throw new Error(`Uploaded file ${value.name} exceeds the 10MB limit`)
    }

    const bytes = await value.arrayBuffer()
    uploads[key] = {
      buffer: Buffer.from(bytes),
      name: value.name,
      type: value.type || 'image/png',
    }
  }

  return uploads
}

function normalizeHideSelectors(rawHideSelectors, pageName) {
  if (rawHideSelectors == null || rawHideSelectors === '') {
    return []
  }

  if (typeof rawHideSelectors === 'string') {
    return rawHideSelectors
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  if (!Array.isArray(rawHideSelectors)) {
    throw new Error(`hideSelectors for page "${pageName}" must be a string or array`)
  }

  return rawHideSelectors.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`hideSelectors entry ${index + 1} for page "${pageName}" must be a non-empty string`)
    }

    return entry.trim()
  })
}

function normalizeComponents(rawComponents, pageName, uploads, suite) {
  if (!Array.isArray(rawComponents)) {
    throw new Error(`Components for page "${pageName}" must be an array`)
  }

  const components = rawComponents.map((component, index) => {
    if (!isPlainObject(component)) {
      throw new Error(`Component ${index + 1} for page "${pageName}" is invalid`)
    }

    const normalizedComponent = {
      name: asNonEmptyString(component.name, `Component ${index + 1} name`),
      selector: asNonEmptyString(component.selector, `Component ${index + 1} selector`),
    }

    if (typeof component.referenceImageDesktopKey === 'string' && component.referenceImageDesktopKey.trim()) {
      normalizedComponent.referenceImageDesktopKey = component.referenceImageDesktopKey.trim()
    }

    if (typeof component.referenceImageMobileKey === 'string' && component.referenceImageMobileKey.trim()) {
      normalizedComponent.referenceImageMobileKey = component.referenceImageMobileKey.trim()
    }

    if (suite === 'pixelmatch') {
      if (!normalizedComponent.referenceImageDesktopKey || !uploads[normalizedComponent.referenceImageDesktopKey]) {
        throw new Error(`Component "${normalizedComponent.name}" is missing a desktop baseline PNG`)
      }
      if (!normalizedComponent.referenceImageMobileKey || !uploads[normalizedComponent.referenceImageMobileKey]) {
        throw new Error(`Component "${normalizedComponent.name}" is missing a mobile baseline PNG`)
      }
    }

    return normalizedComponent
  })

  return components
}

function normalizeViewportDimension(value, label) {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(typeof value === 'string' ? value.trim() : '', 10)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`)
  }

  return parsed
}

function normalizeViewport(rawViewport, suite) {
  if (suite !== 'pixelmatch' && suite !== 'responsive') {
    return null
  }

  if (!isPlainObject(rawViewport)) {
    return DEFAULT_VIEWPORT
  }

  const desktop = isPlainObject(rawViewport.desktop) ? rawViewport.desktop : DEFAULT_VIEWPORT.desktop
  const mobile = isPlainObject(rawViewport.mobile) ? rawViewport.mobile : DEFAULT_VIEWPORT.mobile

  return {
    desktop: {
      width: normalizeViewportDimension(desktop.width ?? DEFAULT_VIEWPORT.desktop.width, 'Desktop width'),
      height: normalizeViewportDimension(desktop.height ?? DEFAULT_VIEWPORT.desktop.height, 'Desktop height'),
    },
    mobile: {
      width: normalizeViewportDimension(mobile.width ?? DEFAULT_VIEWPORT.mobile.width, 'Mobile width'),
      height: normalizeViewportDimension(mobile.height ?? DEFAULT_VIEWPORT.mobile.height, 'Mobile height'),
    },
  }
}

function normalizePages(rawPages, uploads, suite) {
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    throw new Error('At least one page is required')
  }

  return rawPages.map((page, index) => {
    if (!isPlainObject(page)) {
      throw new Error(`Page ${index + 1} is invalid`)
    }

    const pageName = page.name ?? `Page ${index + 1}`
    const hideSelectors = normalizeHideSelectors(page.hideSelectors, pageName)
    const normalizedPage = {
      name: asNonEmptyString(page.name, `Page ${index + 1} name`),
      url: normalizePageUrl(page.url),
      components: normalizeComponents(page.components ?? [], pageName, uploads, suite),
    }

    if (suite === 'pixelmatch' && hideSelectors.length > 0) {
      normalizedPage.hideSelectors = hideSelectors
    }

    if (suite === 'pixelmatch' && page.hideFixed === true) {
      normalizedPage.hideFixed = true
    }

    return normalizedPage
  })
}

function normalizeTypography(rawTypography) {
  if (!isPlainObject(rawTypography) || Object.keys(rawTypography).length === 0) {
    throw new Error('Typography configuration must contain at least one block')
  }

  return rawTypography
}

export async function parseAuditFormData(formData) {
  const rawDefinition = formData.get('definition')
  if (typeof rawDefinition !== 'string') {
    throw new Error('Audit definition is required')
  }

  let definition
  try {
    definition = JSON.parse(rawDefinition)
  } catch {
    throw new Error('Audit definition must be valid JSON')
  }

  if (!isPlainObject(definition)) {
    throw new Error('Audit definition must be an object')
  }

  const uploads = await parseUploads(formData)
  const suite = asNonEmptyString(definition.suite, 'Suite')

  return {
    url: asNonEmptyString(definition.url, 'URL'),
    suite,
    pages: normalizePages(definition.pages, uploads, suite),
    viewport: normalizeViewport(definition.viewport, suite),
    typography: normalizeTypography(definition.typography),
    uploads,
  }
}
