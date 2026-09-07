'use client'

import { useEffect, useRef, useState } from 'react'
import defaultTypographyTemplate from '../configs/playwright.typography.json'

const SUITES = [
  {
    id: 'pixelmatch',
    label: 'Perfect Pixel',
    estSec: 180,
    description: 'Compare uploaded baseline screenshots against the live site.',
  },
  {
    id: 'typography',
    label: 'Typography',
    estSec: 120,
    description: 'Check headings, text, buttons, and links against token rules.',
  },
  {
    id: 'seo',
    label: 'SEO',
    estSec: 90,
    description: 'Check titles, meta tags, headings, canonicals, and page SEO.',
  },
  {
    id: 'lighthouse',
    label: 'Lighthouse',
    estSec: 240,
    description: 'Run performance, accessibility, best practices, and SEO scores.',
  },
  {
    id: 'ada',
    label: 'ADA',
    estSec: 90,
    description: 'Run accessibility checks and generate a WCAG-focused PDF report.',
  },
  {
    id: 'responsive',
    label: 'Responsive',
    estSec: 120,
    description: 'Capture full-page screenshots across desktop and mobile viewports.',
  },
]

const STEP_META = {
  url: 'Storefront URL',
  suite: 'Choose Audit',
  pages: 'Pages',
  config: 'Audit Setup',
  review: 'Review & Run',
}

const TYPOGRAPHY_BLOCK_OPTIONS = [
  { name: 'HEADINGS', label: 'Headings', matches: 'h1 to h6' },
  { name: 'PARAGRAPH', label: 'Paragraph', matches: 'p' },
  { name: 'ANCHOR', label: 'Anchor', matches: 'a' },
  { name: 'BUTTON', label: 'Button', matches: 'button' },
]

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function fmtTime(sec) {
  if (sec <= 0) return 'almost done'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `~${s}s`
  return s === 0 ? `~${m} min` : `~${m}m ${s}s`
}

function cloneTypographyTemplate() {
  return JSON.parse(JSON.stringify(defaultTypographyTemplate))
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function createPage() {
  return { id: makeId(), name: 'Home Page', url: '/', components: [] }
}

function createComponent() {
  return { id: makeId(), name: '', selector: '', desktopFile: null, mobileFile: null }
}

function createTypographyBlocks() {
  const template = cloneTypographyTemplate()
  return TYPOGRAPHY_BLOCK_OPTIONS.filter((option) => template[option.name]).map((option) => ({
    id: makeId(),
    name: option.name,
    value: cloneValue(template[option.name]),
  }))
}

function isPublicHttpUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizePageUrl(value) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')) {
    return trimmed
  }
  return `/${trimmed}`
}

function setNestedValue(target, path, nextValue) {
  if (path.length === 0) {
    return nextValue
  }

  const [head, ...rest] = path
  return {
    ...target,
    [head]: setNestedValue(target[head], rest, nextValue),
  }
}

function buildTypographyObject(blocks) {
  const result = {}

  for (const block of blocks) {
    const blockName = block.name.trim()
    if (!blockName) {
      return { error: 'Each typography block needs a name.' }
    }

    if (result[blockName]) {
      return { error: `Typography block "${blockName}" is duplicated.` }
    }

    result[blockName] = cloneValue(block.value)
  }

  return { value: result }
}

function formatFieldLabel(value) {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getTypographyBlockMeta(name) {
  return TYPOGRAPHY_BLOCK_OPTIONS.find((option) => option.name === name) ?? {
    name,
    label: formatFieldLabel(name),
    matches: 'custom tag mapping',
  }
}

export default function Home() {
  const [url, setUrl] = useState('')
  const [activeSuite, setActiveSuite] = useState(null)
  const [pages, setPages] = useState([createPage()])
  const [typographyBlocks, setTypographyBlocks] = useState(createTypographyBlocks)
  const [stepIndex, setStepIndex] = useState(0)
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState(null)
  const [jobError, setJobError] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [jobStage, setJobStage] = useState(null)
  const [jobProgress, setJobProgress] = useState(null)
  const [jobLastMessage, setJobLastMessage] = useState(null)
  const [queuePosition, setQueuePosition] = useState(null)
  const [reportFiles, setReportFiles] = useState([])
  const [highlightedTypographyBlockId, setHighlightedTypographyBlockId] = useState(null)
  const [pendingTypographyBlockId, setPendingTypographyBlockId] = useState(null)
  const startRef = useRef(null)
  const pollRef = useRef(null)
  const tickRef = useRef(null)
  const typographyBlockRefs = useRef({})

  const isPixelmatch = activeSuite === 'pixelmatch'
  const isTypography = activeSuite === 'typography'
  const isRunning = status === 'queued' || status === 'running'
  const estSec = SUITES.find((suite) => suite.id === activeSuite)?.estSec ?? 120
  const remaining = Math.max(0, estSec - elapsed)
  const fallbackPct = Math.min(95, Math.round((elapsed / estSec) * 100))
  const pct = jobProgress ?? fallbackPct
  const steps = ['url', 'suite', 'pages', ...(isPixelmatch || isTypography ? ['config'] : []), 'review']
  const currentStep = steps[stepIndex] ?? 'url'
  const missingTypographyBlocks = TYPOGRAPHY_BLOCK_OPTIONS.filter(
    (option) => !typographyBlocks.some((block) => block.name === option.name),
  )

  useEffect(() => {
    setStepIndex((current) => Math.min(current, steps.length - 1))
  }, [steps.length])

  useEffect(() => {
    if (!pendingTypographyBlockId) return

    const node = typographyBlockRefs.current[pendingTypographyBlockId]
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedTypographyBlockId(pendingTypographyBlockId)
    }

    setPendingTypographyBlockId(null)
    const timer = setTimeout(() => setHighlightedTypographyBlockId(null), 1800)
    return () => clearTimeout(timer)
  }, [pendingTypographyBlockId, typographyBlocks])

  function stopTimers() {
    clearInterval(pollRef.current)
    clearInterval(tickRef.current)
    pollRef.current = null
    tickRef.current = null
  }

  function resetJobState() {
    stopTimers()
    setJobId(null)
    setStatus(null)
    setJobError(null)
    setElapsed(0)
    setJobStage(null)
    setJobProgress(null)
    setJobLastMessage(null)
    setQueuePosition(null)
    setReportFiles([])
    startRef.current = null
  }

  function clearAll() {
    resetJobState()
    setUrl('')
    setActiveSuite(null)
    setPages([createPage()])
    setTypographyBlocks(createTypographyBlocks())
    setHighlightedTypographyBlockId(null)
    setPendingTypographyBlockId(null)
    setStepIndex(0)
  }

  function resetForEditing() {
    resetJobState()
    setStepIndex(Math.max(steps.length - 1, 0))
  }

  function addPage() {
    setPages((current) => [...current, createPage()])
  }

  function updatePage(pageId, field, value) {
    setPages((current) =>
      current.map((page) => (page.id === pageId ? { ...page, [field]: value } : page)),
    )
  }

  function removePage(pageId) {
    setPages((current) => (current.length === 1 ? current : current.filter((page) => page.id !== pageId)))
  }

  function addComponent(pageId) {
    setPages((current) =>
      current.map((page) =>
        page.id === pageId ? { ...page, components: [...page.components, createComponent()] } : page,
      ),
    )
  }

  function updateComponent(pageId, componentId, field, value) {
    setPages((current) =>
      current.map((page) =>
        page.id !== pageId
          ? page
          : {
              ...page,
              components: page.components.map((component) =>
                component.id === componentId ? { ...component, [field]: value } : component,
              ),
            },
      ),
    )
  }

  function removeComponent(pageId, componentId) {
    setPages((current) =>
      current.map((page) =>
        page.id !== pageId
          ? page
          : {
              ...page,
              components: page.components.filter((component) => component.id !== componentId),
            },
      ),
    )
  }

  function addTypographyBlock(blockName) {
    const template = cloneTypographyTemplate()
    if (!template[blockName]) return

    const newBlock = {
      id: makeId(),
      name: blockName,
      value: cloneValue(template[blockName]),
    }

    setTypographyBlocks((current) => {
      if (current.some((block) => block.name === blockName)) {
        return current
      }

      return [...current, newBlock]
    })
    setPendingTypographyBlockId(newBlock.id)
  }

  function updateTypographyBlockValue(blockId, path, value) {
    setTypographyBlocks((current) =>
      current.map((block) =>
        block.id !== blockId
          ? block
          : {
              ...block,
              value: setNestedValue(block.value, path, value),
            },
      ),
    )
  }

  function removeTypographyBlock(blockId) {
    setTypographyBlocks((current) => (current.length === 1 ? current : current.filter((block) => block.id !== blockId)))
  }

  function resetTypographyTemplate() {
    setTypographyBlocks(createTypographyBlocks())
  }

  function getPageValidationErrors() {
    if (pages.length === 0) {
      return ['Add at least one page.']
    }

    const errors = []
    pages.forEach((page, index) => {
      if (!page.name.trim()) {
        errors.push(`Page ${index + 1} needs a name.`)
      }
      if (!page.url.trim()) {
        errors.push(`Page ${index + 1} needs a URL path.`)
      }
    })
    return errors
  }

  function getPixelmatchValidationErrors() {
    const errors = []
    const totalComponents = pages.reduce((count, page) => count + page.components.length, 0)

    if (totalComponents === 0) {
      errors.push('Add at least one component for Perfect Pixel.')
    }

    pages.forEach((page) => {
      page.components.forEach((component, index) => {
        if (!component.name.trim()) {
          errors.push(`${page.name || 'A page'} component ${index + 1} needs a name.`)
        }
        if (!component.selector.trim()) {
          errors.push(`${page.name || 'A page'} component ${index + 1} needs a selector.`)
        }
        if (!component.desktopFile) {
          errors.push(`${component.name || `Component ${index + 1}`} needs a desktop baseline image.`)
        }
        if (!component.mobileFile) {
          errors.push(`${component.name || `Component ${index + 1}`} needs a mobile baseline image.`)
        }
      })
    })

    return errors
  }

  function getTypographyValidationErrors() {
    if (typographyBlocks.length === 0) {
      return ['Add at least one typography block.']
    }

    const parsed = buildTypographyObject(typographyBlocks)
    return parsed.error ? [parsed.error] : []
  }

  function getCurrentStepErrors() {
    if (currentStep === 'url') {
      return isPublicHttpUrl(url.trim()) ? [] : ['Enter a valid public http or https URL.']
    }

    if (currentStep === 'suite') {
      return activeSuite ? [] : ['Choose an audit type.']
    }

    if (currentStep === 'pages') {
      return getPageValidationErrors()
    }

    if (currentStep === 'config' && isPixelmatch) {
      return getPixelmatchValidationErrors()
    }

    if (currentStep === 'config' && isTypography) {
      return getTypographyValidationErrors()
    }

    const allErrors = [
      ...(isPublicHttpUrl(url.trim()) ? [] : ['Enter a valid public http or https URL.']),
      ...(activeSuite ? [] : ['Choose an audit type.']),
      ...getPageValidationErrors(),
      ...(isPixelmatch ? getPixelmatchValidationErrors() : []),
      ...(isTypography ? getTypographyValidationErrors() : []),
    ]

    return allErrors
  }

  function canGoNext() {
    return getCurrentStepErrors().length === 0
  }

  function buildDefinition() {
    const parsedTypography = buildTypographyObject(typographyBlocks)
    if (parsedTypography.error) {
      throw new Error(parsedTypography.error)
    }

    const definition = {
      url: url.trim(),
      suite: activeSuite,
      pages: [],
      typography: parsedTypography.value,
    }

    const formData = new FormData()

    const normalizedPages = pages.map((page) => ({
      name: page.name.trim(),
      url: normalizePageUrl(page.url),
      components: page.components.map((component) => {
        const normalizedComponent = {
          name: component.name.trim(),
          selector: component.selector.trim(),
        }

        if (component.desktopFile) {
          const desktopKey = `desktop:${page.id}:${component.id}`
          formData.append(desktopKey, component.desktopFile)
          normalizedComponent.referenceImageDesktopKey = desktopKey
        }

        if (component.mobileFile) {
          const mobileKey = `mobile:${page.id}:${component.id}`
          formData.append(mobileKey, component.mobileFile)
          normalizedComponent.referenceImageMobileKey = mobileKey
        }

        return normalizedComponent
      }),
    }))

    definition.pages = normalizedPages
    formData.append('definition', JSON.stringify(definition))

    return { formData, definition }
  }

  async function startAudit() {
    resetJobState()

    let payload
    try {
      payload = buildDefinition()
    } catch (error) {
      setJobError(error instanceof Error ? error.message : 'Failed to build the audit request.')
      setStatus('failed')
      return
    }

    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        body: payload.formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start audit')

      startRef.current = Date.now()
      setJobId(data.jobId)
      setStatus('queued')
      setJobStage('Queued')
      setJobProgress(5)
      setJobLastMessage('Waiting for an available audit slot')
    } catch (error) {
      setJobError(error instanceof Error ? error.message : 'Failed to start audit')
      setStatus('failed')
    }
  }

  useEffect(() => {
    if (!jobId || (status !== 'queued' && status !== 'running')) return
    tickRef.current = setInterval(() => {
      if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(tickRef.current)
  }, [jobId, status])

  useEffect(() => {
    if (!jobId) return

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/audits/${jobId}`)
        if (!res.ok) {
          setStatus('failed')
          setJobError(
            res.status === 404
              ? 'Job not found. The run may have expired or the server restarted.'
              : `Unexpected server error (${res.status})`,
          )
          stopTimers()
          return
        }

        const data = await res.json()
        setStatus(data.status)
        if (data.error) setJobError(data.error)
        setJobStage(data.stage ?? null)
        setJobProgress(data.progress ?? null)
        setJobLastMessage(data.lastMessage ?? null)
        setQueuePosition(data.queuePosition ?? null)
        setReportFiles(Array.isArray(data.reportFiles) ? data.reportFiles : [])

        if (data.status === 'done' || data.status === 'failed') {
          stopTimers()
          if (startRef.current) {
            setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
          }
        }
      } catch {
        // Keep polling on transient errors.
      }
    }, 2000)

    return () => clearInterval(pollRef.current)
  }, [jobId])

  function downloadPdf(fileName) {
    const suffix = fileName ? `?file=${encodeURIComponent(fileName)}` : ''
    window.location.href = `/api/audits/${jobId}/download${suffix}`
  }

  function goNext() {
    if (!canGoNext()) return
    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  function goBack() {
    setStepIndex((current) => Math.max(current - 1, 0))
  }

  const stepErrors = getCurrentStepErrors()

  function renderTypographyFields(blockId, value, path = [], depth = 0) {
    const entries = Object.entries(value)
    const allLeafValues = entries.every(
      ([, nestedValue]) =>
        typeof nestedValue !== 'object' || nestedValue === null || Array.isArray(nestedValue),
    )

    return entries.map(([key, nestedValue]) => {
      const fieldPath = [...path, key]
      const fieldId = `${blockId}-${fieldPath.join('-')}`
      const isObject = typeof nestedValue === 'object' && nestedValue !== null && !Array.isArray(nestedValue)

      if (isObject) {
        return (
          <div
            key={fieldId}
            className={`space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 ${
              depth > 0 ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-zinc-900'
            }`}
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {formatFieldLabel(key)}
            </div>
            <div
              className={
                allLeafValues
                  ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3'
                  : 'grid gap-4 xl:grid-cols-2'
              }
            >
              {renderTypographyFields(blockId, nestedValue, fieldPath, depth + 1)}
            </div>
          </div>
        )
      }

      return (
        <label key={fieldId} className="space-y-1 rounded-lg">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {formatFieldLabel(key)}
          </span>
          <input
            type="text"
            value={nestedValue ?? ''}
            onChange={(e) => updateTypographyBlockValue(blockId, fieldPath, e.target.value)}
            disabled={isRunning}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
      )
    })
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Storefront Audit Wizard
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Build one audit run step by step. Nothing is saved after you clear or start over.
            </p>
          </div>
          <button
            onClick={clearAll}
            disabled={isRunning}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 disabled:opacity-50"
          >
            Clear and start new
          </button>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid gap-3 md:grid-cols-5">
            {steps.map((step, index) => {
              const isActive = index === stepIndex
              const isDone = index < stepIndex
              return (
                <div
                  key={step}
                  className={`rounded-lg border px-3 py-3 text-sm ${
                    isActive
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : isDone
                        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400'
                  }`}
                >
                  <div className="text-xs uppercase tracking-wide">
                    Step {index + 1}
                  </div>
                  <div className="mt-1 font-medium">{STEP_META[step]}</div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            {currentStep === 'url' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    Enter the storefront URL
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Use the public page you want to audit, like `https://example.com`.
                  </p>
                </div>

                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={isRunning}
                  placeholder="https://example.com"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                />
              </div>
            )}

            {currentStep === 'suite' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    Choose the audit type
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Pick the report you want to generate for this run.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {SUITES.map((suite) => (
                    <button
                      key={suite.id}
                      type="button"
                      disabled={isRunning}
                      onClick={() => setActiveSuite(suite.id)}
                      className={`rounded-xl border p-4 text-left transition ${
                        activeSuite === suite.id
                          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <div className="text-sm font-semibold">{suite.label}</div>
                      <div className="mt-2 text-xs opacity-80">{suite.description}</div>
                      <div className="mt-3 text-xs opacity-70">Estimated time: {fmtTime(suite.estSec)}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {currentStep === 'pages' && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      Add the pages to audit
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Give each page a name and path. You can add more pages at any time.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addPage}
                    disabled={isRunning}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700"
                  >
                    Add page
                  </button>
                </div>

                <div className="space-y-4">
                  {pages.map((page, index) => (
                    <div
                      key={page.id}
                      className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                          Page {index + 1}
                        </h3>
                        <button
                          type="button"
                          onClick={() => removePage(page.id)}
                          disabled={isRunning || pages.length === 1}
                          className="text-xs text-red-600 disabled:opacity-40 dark:text-red-400"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            Page name
                          </span>
                          <input
                            type="text"
                            value={page.name}
                            onChange={(e) => updatePage(page.id, 'name', e.target.value)}
                            disabled={isRunning}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            Path or full URL
                          </span>
                          <input
                            type="text"
                            value={page.url}
                            onChange={(e) => updatePage(page.id, 'url', e.target.value)}
                            disabled={isRunning}
                            placeholder="/"
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentStep === 'config' && isPixelmatch && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    Set up Perfect Pixel
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    For each page, add the sections to compare and upload both desktop and mobile baseline PNGs.
                  </p>
                </div>

                <div className="space-y-4">
                  {pages.map((page) => (
                    <div key={page.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                            {page.name || 'Untitled page'}
                          </h3>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">{normalizePageUrl(page.url) || '/'}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addComponent(page.id)}
                          disabled={isRunning}
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700"
                        >
                          Add component
                        </button>
                      </div>

                      <div className="space-y-4">
                        {page.components.length === 0 && (
                          <p className="rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                            No components yet. Add one to upload baseline images.
                          </p>
                        )}

                        {page.components.map((component, index) => (
                          <div
                            key={component.id}
                            className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <h4 className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                                Component {index + 1}
                              </h4>
                              <button
                                type="button"
                                onClick={() => removeComponent(page.id, component.id)}
                                disabled={isRunning}
                                className="text-xs text-red-600 dark:text-red-400"
                              >
                                Remove
                              </button>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <label className="space-y-1">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                  Component name
                                </span>
                                <input
                                  type="text"
                                  value={component.name}
                                  onChange={(e) => updateComponent(page.id, component.id, 'name', e.target.value)}
                                  disabled={isRunning}
                                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
                                />
                              </label>

                              <label className="space-y-1">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                  Selector
                                </span>
                                <input
                                  type="text"
                                  value={component.selector}
                                  onChange={(e) => updateComponent(page.id, component.id, 'selector', e.target.value)}
                                  disabled={isRunning}
                                  placeholder="header, .hero, #cta, [data-testid=&quot;hero&quot;]"
                                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
                                />
                              </label>

                              <label className="space-y-1">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                  Desktop baseline PNG
                                </span>
                                <input
                                  type="file"
                                  accept="image/png"
                                  disabled={isRunning}
                                  onChange={(e) => updateComponent(page.id, component.id, 'desktopFile', e.target.files?.[0] ?? null)}
                                  className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                                />
                                {component.desktopFile && (
                                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {component.desktopFile.name}
                                  </p>
                                )}
                              </label>

                              <label className="space-y-1">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                  Mobile baseline PNG
                                </span>
                                <input
                                  type="file"
                                  accept="image/png"
                                  disabled={isRunning}
                                  onChange={(e) => updateComponent(page.id, component.id, 'mobileFile', e.target.files?.[0] ?? null)}
                                  className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                                />
                                {component.mobileFile && (
                                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {component.mobileFile.name}
                                  </p>
                                )}
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentStep === 'config' && isTypography && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      Edit typography blocks
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Each block maps to a real HTML tag group used by the audit.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={resetTypographyTemplate}
                      disabled={isRunning}
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700"
                    >
                      Reset template
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                  <div className="font-medium text-zinc-800 dark:text-zinc-100">Supported tag mapping</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {TYPOGRAPHY_BLOCK_OPTIONS.map((option) => (
                      <div key={option.name} className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                        <div className="text-sm font-medium">{option.label}</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">Matches: {option.matches}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {missingTypographyBlocks.length > 0 && (
                  <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="mb-3 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      Restore a removed block
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {missingTypographyBlocks.map((option) => (
                        <button
                          key={option.name}
                          type="button"
                          onClick={() => addTypographyBlock(option.name)}
                          disabled={isRunning}
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700"
                        >
                          Add {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  {typographyBlocks.map((block) => (
                    <div
                      key={block.id}
                      ref={(node) => {
                        if (node) {
                          typographyBlockRefs.current[block.id] = node
                        }
                      }}
                      className={`rounded-xl border p-4 transition ${
                        highlightedTypographyBlockId === block.id
                          ? 'border-blue-500 ring-2 ring-blue-500/40'
                          : 'border-zinc-200 dark:border-zinc-800'
                      }`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                            {getTypographyBlockMeta(block.name).label}
                          </h3>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Matches: {getTypographyBlockMeta(block.name).matches}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => removeTypographyBlock(block.id)}
                            disabled={isRunning || typographyBlocks.length === 1}
                            className="text-xs text-red-600 disabled:opacity-40 dark:text-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-3">
                          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            Typography values for {getTypographyBlockMeta(block.name).label}
                          </div>
                          <div className="space-y-3">
                            {renderTypographyFields(block.id, block.value)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentStep === 'review' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    Review and run
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Check the summary below, then start the audit.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Storefront</div>
                    <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">{url || 'Not set'}</div>
                  </div>

                  <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Audit type</div>
                    <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {SUITES.find((suite) => suite.id === activeSuite)?.label || 'Not selected'}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="mb-3 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Pages
                  </div>
                  <div className="space-y-3">
                    {pages.map((page) => (
                      <div key={page.id} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          {page.name || 'Untitled page'}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {normalizePageUrl(page.url) || '/'}
                        </div>
                        {isPixelmatch && (
                          <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                            {page.components.length} component{page.components.length === 1 ? '' : 's'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {isTypography && (
                  <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Typography blocks
                    </div>
                    <div className="mt-2 text-sm text-zinc-900 dark:text-zinc-50">
                      {typographyBlocks.length} block{typographyBlocks.length === 1 ? '' : 's'} ready for this run
                    </div>
                  </div>
                )}

                {isPixelmatch && (
                  <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Perfect Pixel images
                    </div>
                    <div className="mt-2 text-sm text-zinc-900 dark:text-zinc-50">
                      {pages.reduce((count, page) => count + page.components.length, 0)} component baseline set{pages.reduce((count, page) => count + page.components.length, 0) === 1 ? '' : 's'}
                    </div>
                  </div>
                )}
              </div>
            )}

            {stepErrors.length > 0 && (
              <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                <div className="font-medium">Please fix the following before continuing:</div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {stepErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {status && (
              <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                {isRunning && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {jobStage ?? (status === 'queued' ? 'Queued...' : `Running ${activeSuite?.toUpperCase()}...`)}
                        </span>
                      </div>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{elapsed}s elapsed</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-1000"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {jobLastMessage && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Latest update: {jobLastMessage}
                      </p>
                    )}
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {status === 'queued' && queuePosition
                        ? `Queue position: ${queuePosition}`
                        : remaining > 0
                          ? `Typical remaining time: ${fmtTime(remaining)}`
                          : 'This run is taking longer than usual, but it is still working.'}
                    </p>
                  </div>
                )}

                {status === 'done' && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">
                      Audit complete in {elapsed}s.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {reportFiles.length > 1 ? (
                        reportFiles.map((file) => (
                          <button
                            key={file.fileName}
                            onClick={() => downloadPdf(file.fileName)}
                            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                          >
                            Download {file.fileName}
                          </button>
                        ))
                      ) : (
                        <button
                          onClick={() => downloadPdf()}
                          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                        >
                          Download PDF report
                        </button>
                      )}
                      <button
                        onClick={clearAll}
                        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
                      >
                        Clear and start new
                      </button>
                    </div>
                  </div>
                )}

                {status === 'failed' && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-red-600 dark:text-red-400">Audit failed</p>
                    {jobError && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-300 break-words">{jobError}</p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={resetForEditing}
                        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
                      >
                        Back to setup
                      </button>
                      <button
                        onClick={clearAll}
                        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
                      >
                        Clear and start new
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={goBack}
                disabled={stepIndex === 0 || isRunning}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-zinc-700"
              >
                Back
              </button>

              {currentStep === 'review' ? (
                <button
                  type="button"
                  onClick={startAudit}
                  disabled={isRunning || stepErrors.length > 0}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Start audit
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={isRunning || !canGoNext()}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Continue
                </button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Quick Summary</h2>
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">URL</div>
                  <div className="mt-1 break-words text-zinc-800 dark:text-zinc-200">{url || 'Not set'}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Audit</div>
                  <div className="mt-1 text-zinc-800 dark:text-zinc-200">
                    {SUITES.find((suite) => suite.id === activeSuite)?.label || 'Not selected'}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Pages</div>
                  <div className="mt-1 text-zinc-800 dark:text-zinc-200">{pages.length}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Current step</div>
                  <div className="mt-1 text-zinc-800 dark:text-zinc-200">{STEP_META[currentStep]}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">Tips</h2>
              <ul className="mt-3 space-y-2">
                <li>Use relative page paths like `/`, `/collections`, or `/product/example`.</li>
                <li>For Perfect Pixel, upload PNG baselines for both desktop and mobile.</li>
                <li>Selectors can be CSS selectors or data-testid shortcuts supported by the audit kit.</li>
                <li>Typography blocks are temporary for this run unless you copy them elsewhere later.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
