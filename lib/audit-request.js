const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024

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

function normalizePages(rawPages, uploads, suite) {
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    throw new Error('At least one page is required')
  }

  return rawPages.map((page, index) => {
    if (!isPlainObject(page)) {
      throw new Error(`Page ${index + 1} is invalid`)
    }

    const normalizedPage = {
      name: asNonEmptyString(page.name, `Page ${index + 1} name`),
      url: normalizePageUrl(page.url),
      components: normalizeComponents(page.components ?? [], page.name ?? `Page ${index + 1}`, uploads, suite),
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
    typography: normalizeTypography(definition.typography),
    uploads,
  }
}
