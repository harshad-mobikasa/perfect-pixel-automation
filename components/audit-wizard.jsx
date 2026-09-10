'use client'

import { useEffect, useRef, useState } from 'react'
import {
  TypographyEditor,
  buildTypographyObject,
  hydrateTypography,
  serializeTypographyBlocks,
} from './typography-editor.jsx'

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

const DEFAULT_VIEWPORTS = {
  desktop: { width: '1440', height: '956' },
  mobile: { width: '390', height: '844' },
}

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

function createPage() {
  return {
    id: makeId(),
    name: 'Home Page',
    url: '/',
    components: [],
    hideSelectors: '',
    hideFixed: false,
  }
}

function parseHideSelectors(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return []
  }

  return text
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function createComponent() {
  return { id: makeId(), name: '', selector: '', desktopFile: null, mobileFile: null }
}

function createViewportConfig() {
  return {
    desktop: { ...DEFAULT_VIEWPORTS.desktop },
    mobile: { ...DEFAULT_VIEWPORTS.mobile },
  }
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

function hydratePages(rawPages) {
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    return [createPage()]
  }

  return rawPages.map((page) => ({
    id: makeId(),
    name: page.name || 'Home Page',
    url: page.url || '/',
    hideSelectors: page.hideSelectors || '',
    hideFixed: Boolean(page.hideFixed),
    components: Array.isArray(page.components)
      ? page.components.map((component) => ({
          id: makeId(),
          name: component.name || '',
          selector: component.selector || '',
          desktopFile: null,
          mobileFile: null,
        }))
      : [],
  }))
}

function hydrateViewport(rawViewport) {
  const defaults = createViewportConfig()
  return {
    desktop: {
      width: String(rawViewport?.desktop?.width ?? defaults.desktop.width),
      height: String(rawViewport?.desktop?.height ?? defaults.desktop.height),
    },
    mobile: {
      width: String(rawViewport?.mobile?.width ?? defaults.mobile.width),
      height: String(rawViewport?.mobile?.height ?? defaults.mobile.height),
    },
  }
}

function jobStorageKey(projectId) {
  return `audit-active-job:${projectId}`
}

function readStoredJob(projectId) {
  if (!projectId || typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(jobStorageKey(projectId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStoredJob(projectId, payload) {
  if (!projectId || typeof window === 'undefined') return
  window.sessionStorage.setItem(jobStorageKey(projectId), JSON.stringify(payload))
}

function clearStoredJob(projectId) {
  if (!projectId || typeof window === 'undefined') return
  window.sessionStorage.removeItem(jobStorageKey(projectId))
}

function suiteLabel(suiteId) {
  return SUITES.find((suite) => suite.id === suiteId)?.label ?? suiteId ?? 'Audit'
}

function isBehindOthers(job) {
  const waitingAhead = job?.waitingAhead ?? 0
  const queuePosition = job?.queuePosition ?? 0
  const runningCount = job?.runningCount ?? 0
  return waitingAhead > 0 || queuePosition > 1 || runningCount > 0
}

function tabLabel(job) {
  const name = suiteLabel(job.suite)
  if (job.status === 'queued') {
    if (isBehindOthers(job) && job.queuePosition) return `${name} · #${job.queuePosition}`
    if (isBehindOthers(job)) return `${name} · waiting`
    return `${name} · starting`
  }
  if (job.status === 'running') return `${name} · running`
  if (job.status === 'done') return `${name} · done`
  if (job.status === 'failed') return `${name} · error`
  return name
}

const COLLAPSE_FINISHED_MS = 45 * 1000

function queueStatusText(status, queuePosition, waitingAhead, runningCount) {
  if (status !== 'queued') return null
  const ahead = waitingAhead || (queuePosition > 1 ? queuePosition - 1 : 0)
  if (ahead > 0) {
    return `${ahead} audit${ahead === 1 ? '' : 's'} ahead of you. You are #${queuePosition} in the queue.`
  }
  if (runningCount > 0) {
    return 'Another audit is running on the worker. Yours starts next.'
  }
  return 'Starting this audit. The worker will pick it up in a moment.'
}

export default function AuditWizard({ project, onSaveConfig }) {
  const [url, setUrl] = useState(project?.config?.url ?? '')
  const [activeSuite, setActiveSuite] = useState(null)
  const [pages, setPages] = useState(() => hydratePages(project?.config?.pages))
  const [viewportConfig, setViewportConfig] = useState(() => hydrateViewport(project?.config?.viewportConfig))
  const [typographyBlocks, setTypographyBlocks] = useState(() => hydrateTypography(project?.config?.typographyBlocks))
  const [saveState, setSaveState] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState(null)
  const [jobError, setJobError] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [jobStage, setJobStage] = useState(null)
  const [jobProgress, setJobProgress] = useState(null)
  const [jobLastMessage, setJobLastMessage] = useState(null)
  const [queuePosition, setQueuePosition] = useState(null)
  const [waitingAhead, setWaitingAhead] = useState(0)
  const [runningCount, setRunningCount] = useState(0)
  const [reportFiles, setReportFiles] = useState([])
  const [myJobs, setMyJobs] = useState([])
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [finishedSeenAt, setFinishedSeenAt] = useState({})
  const [nowTick, setNowTick] = useState(Date.now())
  const [starting, setStarting] = useState(false)
  const startRef = useRef(null)
  const pollRef = useRef(null)
  const tickRef = useRef(null)

  const isPixelmatch = activeSuite === 'pixelmatch'
  const isResponsive = activeSuite === 'responsive'
  const isTypography = activeSuite === 'typography'
  const visibleJobs = myJobs.filter((job) => {
    if (job.status === 'queued' || job.status === 'running') return true
    const seenAt = finishedSeenAt[job.id]
    if (!seenAt) return true
    return nowTick - seenAt < COLLAPSE_FINISHED_MS
  })
  const visibleJobKey = visibleJobs.map((job) => job.id).join('|')
  const selectedJob = visibleJobs.find((job) => job.id === selectedJobId) ?? null
  const isRunning = selectedJob?.status === 'queued' || selectedJob?.status === 'running'
  const showRunTabs = visibleJobs.length > 1
  const selectedIsQueuedBehind = selectedJob ? isBehindOthers(selectedJob) : false
  const estSec = SUITES.find((suite) => suite.id === activeSuite)?.estSec ?? 120
  const remaining = Math.max(0, estSec - elapsed)
  const fallbackPct = Math.min(95, Math.round((elapsed / estSec) * 100))
  const pct = jobProgress ?? fallbackPct
  const steps = ['url', 'suite', 'pages', ...(isPixelmatch || isResponsive || isTypography ? ['config'] : []), 'review']
  const effectiveStepIndex = Math.min(stepIndex, steps.length - 1)
  const currentStep = steps[effectiveStepIndex] ?? 'url'

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
    setWaitingAhead(0)
    setRunningCount(0)
    setReportFiles([])
    startRef.current = null
  }

  function applyProjectConfig(config) {
    setUrl(config?.url ?? '')
    setActiveSuite(null)
    setPages(hydratePages(config?.pages))
    setViewportConfig(hydrateViewport(config?.viewportConfig))
    setTypographyBlocks(hydrateTypography(config?.typographyBlocks))
    setStepIndex(0)
    setSaveState(null)
  }

  function clearAll() {
    clearStoredJob(project?.id)
    resetJobState()
    applyProjectConfig(project?.config)
  }

  function serializeProjectConfig() {
    return {
      url: url.trim(),
      pages: pages.map((page) => ({
        name: page.name,
        url: page.url,
        hideSelectors: page.hideSelectors,
        hideFixed: page.hideFixed,
        components: page.components.map((component) => ({
          name: component.name,
          selector: component.selector,
        })),
      })),
      viewportConfig,
      typographyBlocks: serializeTypographyBlocks(typographyBlocks),
    }
  }

  async function saveProjectConfig() {
    if (!onSaveConfig) return
    setSaveState('saving')
    try {
      await onSaveConfig(serializeProjectConfig())
      setSaveState('saved')
      setTimeout(() => setSaveState(null), 2000)
    } catch (error) {
      setSaveState(error instanceof Error ? error.message : 'Could not save project setup')
    }
  }

  function applyJobSnapshot(job) {
    if (!job) return
    setJobId(job.id)
    setStatus(job.status ?? null)
    setJobError(job.error ?? null)
    setJobStage(job.stage ?? null)
    setJobProgress(job.progress ?? null)
    setJobLastMessage(job.lastMessage ?? null)
    setQueuePosition(job.queuePosition ?? null)
    setWaitingAhead(job.waitingAhead ?? 0)
    setRunningCount(job.runningCount ?? 0)
    setReportFiles(Array.isArray(job.reportFiles) ? job.reportFiles : [])
    if (job.createdAt) {
      startRef.current = job.createdAt
      setElapsed(Math.max(0, Math.floor((Date.now() - job.createdAt) / 1000)))
    }
  }

  function selectJob(job) {
    if (!job) return
    setSelectedJobId(job.id)
    applyJobSnapshot(job)
    writeStoredJob(project?.id, {
      jobId: job.id,
      suite: job.suite ?? activeSuite,
      startedAt: startRef.current ?? Date.now(),
    })
  }

  function startNewAudit() {
    setSelectedJobId(null)
    resetJobState()
    clearStoredJob(project?.id)
    setStepIndex(0)
  }

  async function refreshMyJobs() {
    if (!project?.id) return []
    const res = await fetch(`/api/audits?projectId=${encodeURIComponent(project.id)}`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    const jobs = Array.isArray(data.jobs) ? data.jobs : []
    setMyJobs(jobs)
    setFinishedSeenAt((current) => {
      const next = { ...current }
      for (const job of jobs) {
        if ((job.status === 'done' || job.status === 'failed') && !next[job.id]) {
          next[job.id] = Date.now()
        }
      }
      return next
    })
    return jobs
  }

  function collapseHint(job) {
    if (job.status !== 'done' && job.status !== 'failed') return null
    const seenAt = finishedSeenAt[job.id]
    if (!seenAt) return 'Hides soon'
    const left = Math.max(0, Math.ceil((COLLAPSE_FINISHED_MS - (nowTick - seenAt)) / 1000))
    return `Hides in ${left}s`
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

  function updateViewport(device, field, value) {
    setViewportConfig((current) => ({
      ...current,
      [device]: {
        ...current[device],
        [field]: value,
      },
    }))
  }

  function resetViewportDefaults() {
    setViewportConfig(createViewportConfig())
  }

  function normalizeViewportNumber(value, label) {
    const parsed = Number.parseInt(String(value).trim(), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${label} must be a positive number`)
    }
    return parsed
  }

  function buildViewportDefinition() {
    return {
      desktop: {
        width: normalizeViewportNumber(viewportConfig.desktop.width, 'Desktop width'),
        height: normalizeViewportNumber(viewportConfig.desktop.height, 'Desktop height'),
      },
      mobile: {
        width: normalizeViewportNumber(viewportConfig.mobile.width, 'Mobile width'),
        height: normalizeViewportNumber(viewportConfig.mobile.height, 'Mobile height'),
      },
    }
  }

  function getViewportValidationErrors() {
    if (!isPixelmatch && !isResponsive) {
      return []
    }

    const labels = [
      ['desktop', 'width', 'Desktop width'],
      ['desktop', 'height', 'Desktop height'],
      ['mobile', 'width', 'Mobile width'],
      ['mobile', 'height', 'Mobile height'],
    ]

    return labels.flatMap(([device, field, label]) => {
      const parsed = Number.parseInt(String(viewportConfig[device][field]).trim(), 10)
      return Number.isFinite(parsed) && parsed > 0 ? [] : [`${label} must be a positive number.`]
    })
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
      return [...getViewportValidationErrors(), ...getPixelmatchValidationErrors()]
    }

    if (currentStep === 'config' && isResponsive) {
      return getViewportValidationErrors()
    }

    if (currentStep === 'config' && isTypography) {
      return getTypographyValidationErrors()
    }

    const allErrors = [
      ...(isPublicHttpUrl(url.trim()) ? [] : ['Enter a valid public http or https URL.']),
      ...(activeSuite ? [] : ['Choose an audit type.']),
      ...getPageValidationErrors(),
      ...((isPixelmatch || isResponsive) ? getViewportValidationErrors() : []),
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

    if (isPixelmatch || isResponsive) {
      definition.viewport = buildViewportDefinition()
    }

    const formData = new FormData()

    const normalizedPages = pages.map((page) => {
      const hideSelectors = parseHideSelectors(page.hideSelectors)
      const normalizedPage = {
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
      }

      if (isPixelmatch && hideSelectors.length > 0) {
        normalizedPage.hideSelectors = hideSelectors
      }

      if (isPixelmatch && page.hideFixed) {
        normalizedPage.hideFixed = true
      }

      return normalizedPage
    })

    if (!project?.id) {
      throw new Error('Select a project before starting an audit')
    }

    definition.pages = normalizedPages
    formData.append('definition', JSON.stringify(definition))
    formData.append('projectId', project.id)

    return { formData, definition }
  }

  async function startAudit() {
    if (starting) return

    let payload
    try {
      payload = buildDefinition()
    } catch (error) {
      setJobError(error instanceof Error ? error.message : 'Failed to build the audit request.')
      setStatus('failed')
      return
    }

    setStarting(true)
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        body: payload.formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start audit')

      startRef.current = Date.now()
      const queued = {
        id: data.jobId,
        status: 'queued',
        suite: payload.definition?.suite ?? activeSuite,
        error: null,
        stage: 'Queued',
        progress: 5,
        lastMessage: 'Waiting for an available audit slot',
        queuePosition: null,
        waitingAhead: 0,
        runningCount: 0,
        reportFiles: [],
      }
      selectJob(queued)
      await refreshMyJobs()
    } catch (error) {
      setJobError(error instanceof Error ? error.message : 'Failed to start audit')
      setStatus('failed')
    } finally {
      setStarting(false)
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
    let cancelled = false

    async function pollJob() {
      try {
        const res = await fetch(`/api/audits/${jobId}`, { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          setStatus('failed')
          setJobError(
            res.status === 404
              ? 'This run is no longer available. It may have expired (jobs are kept 24 hours) or the worker restarted.'
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
        setWaitingAhead(data.waitingAhead ?? 0)
        setRunningCount(data.runningCount ?? 0)
        setReportFiles(Array.isArray(data.reportFiles) ? data.reportFiles : [])
        writeStoredJob(project?.id, {
          jobId,
          suite: data.suite ?? activeSuite,
          startedAt: startRef.current ?? Date.now(),
        })

        if (data.status === 'done' || data.status === 'failed') {
          stopTimers()
          if (startRef.current) {
            setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
          }
        }
      } catch {
        // Keep polling on transient errors.
      }
    }

    pollJob()
    pollRef.current = setInterval(pollJob, 2000)
    return () => {
      cancelled = true
      clearInterval(pollRef.current)
    }
  }, [jobId])

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!project?.id) return
    let cancelled = false

    async function load(initial) {
      const jobs = await refreshMyJobs()
      if (cancelled || !initial) return
      const stored = readStoredJob(project.id)
      const active = jobs.find((job) => job.status === 'queued' || job.status === 'running')
      const pick = jobs.find((job) => job.id === stored?.jobId) ?? active ?? null
      if (pick) selectJob(pick)
    }

    load(true)
    const timer = setInterval(() => {
      refreshMyJobs()
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [project?.id])

  useEffect(() => {
    if (!selectedJob) return
    applyJobSnapshot(selectedJob)
  }, [selectedJob])

  useEffect(() => {
    if (!selectedJobId) return
    if (visibleJobKey.split('|').includes(selectedJobId)) return
    setSelectedJobId(null)
    resetJobState()
    clearStoredJob(project?.id)
  }, [visibleJobKey, selectedJobId, project?.id])

  function downloadPdf(fileName) {
    const suffix = fileName ? `?file=${encodeURIComponent(fileName)}` : ''
    window.open(`/api/audits/${jobId}/download${suffix}`, '_self')
  }

  function goNext() {
    if (!canGoNext()) return
    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  function goBack() {
    setStepIndex((current) => Math.max(current - 1, 0))
  }

  const stepErrors = getCurrentStepErrors()

  function renderViewportSettings(title, description, note) {
    return (
      <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
          </div>
          <button
            type="button"
            onClick={resetViewportDefaults}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700 cursor-pointer"
          >
            Reset sizes
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {[
            ['desktop', 'Desktop viewport'],
            ['mobile', 'Mobile viewport'],
          ].map(([device, label]) => (
            <div key={device} className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950">
              <div className="mb-3 text-sm font-medium text-zinc-800 dark:text-zinc-100">{label}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Width</span>
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={viewportConfig[device].width}
                    onChange={(event) => updateViewport(device, 'width', event.target.value)}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Height</span>
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={viewportConfig[device].height}
                    onChange={(event) => updateViewport(device, 'height', event.target.value)}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{note}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">
            {project?.name}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[#3C3D41]">
            Storefront audit
          </h1>
          <p className="mt-1 text-sm text-[#3C3D41]/70">
            URL, pages, and typography load from this project’s saved defaults. Change them for a staging run if
            you need to. Save project setup only when you want those values to become the new default.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={saveProjectConfig}
            disabled={saveState === 'saving'}
            className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] disabled:opacity-50 cursor-pointer"
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save project setup'}
          </button>
          <button
            onClick={clearAll}
            className="rounded-lg border border-[#3C3D41]/20 px-4 py-2 text-sm font-medium text-[#3C3D41] disabled:opacity-50 cursor-pointer"
          >
            Reset to saved
          </button>
        </div>
      </div>
      {typeof saveState === 'string' && saveState !== 'saving' && saveState !== 'saved' && (
        <p className="text-sm text-red-600">{saveState}</p>
      )}
      {!selectedJobId && jobError && (
        <p className="text-sm text-red-600">{jobError}</p>
      )}

      {visibleJobs.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {showRunTabs && (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Your runs</h2>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Audits you started in this project. Queue numbers appear only when someone is ahead of a run.
                    Finished and failed tabs hide after 45 seconds.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={startNewAudit}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium dark:border-zinc-700 cursor-pointer"
                >
                  Start another
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {visibleJobs.map((job) => {
                  const selected = job.id === selectedJobId
                  const failed = job.status === 'failed'
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => selectJob(job)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm cursor-pointer ${
                        selected
                          ? failed
                            ? 'border-red-400 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
                            : 'border-[#F58220] bg-[#F58220] text-white'
                          : failed
                            ? 'border-red-200 bg-white text-red-700 dark:border-red-900 dark:bg-zinc-950 dark:text-red-300'
                            : 'border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200'
                      }`}
                    >
                      <div className="font-medium">{tabLabel(job)}</div>
                      {collapseHint(job) && (
                        <div className={`mt-0.5 text-[11px] ${selected ? 'opacity-80' : 'text-zinc-500'}`}>
                          {collapseHint(job)}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {selectedJob && (
            <div className={`${showRunTabs ? 'mt-4 ' : ''}rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950`}>
              {isRunning && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#F58220] animate-pulse" />
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {status === 'queued'
                          ? selectedIsQueuedBehind
                            ? jobStage ?? 'Waiting in queue…'
                            : 'Starting…'
                          : jobStage ?? `Running ${suiteLabel(selectedJob.suite)}…`}
                      </span>
                    </div>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{elapsed}s elapsed</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-[#F58220] transition-all duration-1000"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {selectedIsQueuedBehind && jobLastMessage && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Latest update: {jobLastMessage}</p>
                  )}
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    {status === 'queued'
                      ? queueStatusText(status, queuePosition, waitingAhead, runningCount)
                      : remaining > 0
                        ? `Typical remaining time: ${fmtTime(remaining)}`
                        : 'This run is taking longer than usual, but it is still working.'}
                  </p>
                </div>
              )}

              {status === 'done' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-green-600 dark:text-green-400">Audit complete.</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Download below, or open the project <span className="font-medium">Reports</span> tab.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {reportFiles.length > 1 ? (
                      reportFiles.map((file) => (
                        <button
                          key={file.fileName}
                          type="button"
                          onClick={() => downloadPdf(file.fileName)}
                          className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] cursor-pointer"
                        >
                          Download {file.fileName}
                        </button>
                      ))
                    ) : (
                      <button
                        type="button"
                        onClick={() => downloadPdf()}
                        className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] cursor-pointer"
                      >
                        Download PDF report
                      </button>
                    )}
                  </div>
                </div>
              )}

              {status === 'failed' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">This audit did not finish</p>
                  <p className="text-sm text-zinc-800 dark:text-zinc-100 break-words">
                    {jobError || 'The worker reported a failure, but no extra error text was saved.'}
                  </p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Nothing was saved to Reports for this run. This status hides after 45 seconds. You can start
                    another audit without waiting.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
                      ? 'border-[#F58220] bg-[#F58220] text-white'
                      : isDone
                        ? 'border-[#F58220]/20 bg-[#F58220]/8 text-[#3C3D41]'
                        : 'border-[#3C3D41]/10 bg-white text-[#3C3D41]/60'
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
                    Loaded from the project default. You can point this run at staging or another environment
                    without changing the saved project URL unless you click Save project setup.
                  </p>
                </div>

                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
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
                      onClick={() => setActiveSuite(suite.id)}
                      className={`rounded-xl border p-4 text-left transition cursor-pointer ${
                        activeSuite === suite.id
                          ? 'border-[#F58220] bg-[#F58220] text-white'
                          : 'border-[#3C3D41]/10 bg-[#f7f5f2] hover:bg-white text-[#3C3D41]'
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
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700 cursor-pointer"
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
                          disabled={pages.length === 1}
                          className="text-xs text-red-600 disabled:opacity-40 dark:text-red-400 cursor-pointer"
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
                    Optionally hide popups or overlays before each screenshot.
                  </p>
                </div>

                {renderViewportSettings(
                  'Screen sizes',
                  'The audit will capture desktop and mobile screenshots using these viewport sizes.',
                  'Keep these sizes matched with the baseline PNGs you upload so the comparison stays accurate.',
                )}

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
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700 cursor-pointer"
                        >
                          Add component
                        </button>
                      </div>

                      <label className="mb-4 block space-y-1">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          Hide before screenshot (optional)
                        </span>
                        <textarea
                          value={page.hideSelectors}
                          onChange={(e) => updatePage(page.id, 'hideSelectors', e.target.value)}
                          rows={3}
                          placeholder={"id:newsletter-popup\nclass:cookie-banner\ntestid:promo-modal\ncss:.overlay"}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
                        />
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          One selector per line (or comma-separated). Supports id:, class:, testid:, css:, or raw CSS.
                          Matching elements and their fixed/sticky popup wrappers are hidden before the pixel comparison.
                        </span>
                      </label>

                      <label className="mb-4 flex items-start gap-3 rounded-lg border border-zinc-200 px-3 py-3 dark:border-zinc-800">
                        <input
                          type="checkbox"
                          checked={Boolean(page.hideFixed)}
                          onChange={(e) => updatePage(page.id, 'hideFixed', e.target.checked)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">
                            Hide all fixed overlays
                          </span>
                          <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                            Useful for newsletter modals and dimmed backdrops that sit above the page (`position: fixed`).
                          </span>
                        </span>
                      </label>

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
                                className="text-xs text-red-600 dark:text-red-400 cursor-pointer"
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

            {currentStep === 'config' && isResponsive && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    Set up Responsive
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Choose the desktop and mobile screen sizes to capture for this run.
                  </p>
                </div>

                {renderViewportSettings(
                  'Screen sizes',
                  'Responsive will generate full-page screenshots for the desktop and mobile viewports below.',
                  'Defaults are prefilled, but you can change them any time before starting the audit.',
                )}
              </div>
            )}

            {currentStep === 'config' && isTypography && (
              <div className="space-y-4">
                <TypographyEditor
                  title="Typography for this run"
                  description="These values start from the project default. Change them for this audit (for example a staging URL) without updating the saved default unless you click Save project setup."
                  blocks={typographyBlocks}
                  onChange={setTypographyBlocks}
                />
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
                    {pages.map((page) => {
                      const pageHideSelectors = isPixelmatch ? parseHideSelectors(page.hideSelectors) : []

                      return (
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
                            {pageHideSelectors.length > 0
                              ? ` · ${pageHideSelectors.length} hide selector${pageHideSelectors.length === 1 ? '' : 's'}`
                              : ''}
                            {page.hideFixed ? ' · hide fixed overlays' : ''}
                          </div>
                        )}
                        {pageHideSelectors.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {pageHideSelectors.map((selector) => (
                              <span
                                key={selector}
                                className="rounded bg-zinc-200 px-2 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                              >
                                {selector}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      )
                    })}
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

                {(isPixelmatch || isResponsive) && (
                  <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Screen sizes
                    </div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-950">
                        <div className="font-medium text-zinc-900 dark:text-zinc-50">Desktop</div>
                        <div className="mt-1 text-zinc-600 dark:text-zinc-300">
                          {viewportConfig.desktop.width} x {viewportConfig.desktop.height}
                        </div>
                      </div>
                      <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-950">
                        <div className="font-medium text-zinc-900 dark:text-zinc-50">Mobile</div>
                        <div className="mt-1 text-zinc-600 dark:text-zinc-300">
                          {viewportConfig.mobile.width} x {viewportConfig.mobile.height}
                        </div>
                      </div>
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

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={goBack}
                disabled={stepIndex === 0}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-zinc-700 cursor-pointer"
              >
                Back
              </button>

              {currentStep === 'review' ? (
                <button
                  type="button"
                  onClick={startAudit}
                  disabled={starting || stepErrors.length > 0}
                  className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] disabled:opacity-40 cursor-pointer"
                >
                  {starting ? 'Queuing…' : 'Start audit'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canGoNext()}
                  className="rounded-lg bg-[#F58220] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e27518] disabled:opacity-40 cursor-pointer"
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
                <li>
                  Hide popups with selectors like `class:step-one-form` or `class:newsletter-popup`. Fixed modal
                  backdrops are hidden automatically with the matched element. Use “Hide all fixed overlays” if needed.
                </li>
                <li>Selectors can be CSS selectors or data-testid shortcuts supported by the audit kit.</li>
                <li>
                  Typography, URL, pages, and viewports load from project Settings. Edits here apply to this run
                  until you save them as the project default.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
  )
}
