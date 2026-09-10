import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import pLimit from 'p-limit'
import { getJobStore, globalState } from './job-store.js'
import { getFileStore } from './shopify-file-store.js'
import { archiveProjectRun, cleanupExpiredReports } from './report-store.js'

const generalLimit = pLimit(1)
const lighthouseLimit = pLimit(1)
const BROWSER_SETUP_TIMEOUT_MS = 10 * 60 * 1000
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const JOB_MAX_AGE_MS = 30 * 60 * 1000
const AUDIT_KIT_BIN = join(process.cwd(), 'node_modules', '.bin', 'audit-kit')
const AUDIT_KIT_PATCH_SCRIPT = join(process.cwd(), 'scripts', 'patch-audit-kit.mjs')
const PLAYWRIGHT_CLI = join(process.cwd(), 'node_modules', 'playwright', 'cli.js')

let playwrightInstallPromise = null
let auditKitPatchPromise = null

function getAuditTimeoutMs(suite) {
  switch (suite) {
    case 'lighthouse':
      return 10 * 60 * 1000
    case 'pixelmatch':
    case 'typography':
    case 'responsive':
      return 8 * 60 * 1000
    case 'seo':
    case 'ada':
    default:
      return 6 * 60 * 1000
  }
}

async function setJobStage(jobStore, jobId, stage, progress, detail) {
  const job = await jobStore.getJob(jobId)
  if (!job) return

  const patch = {
    updatedAt: Date.now(),
  }

  if (stage) patch.stage = stage
  if (typeof progress === 'number') {
    patch.progress = Math.max(job.progress ?? 0, progress)
  }
  if (detail) patch.lastMessage = detail

  await jobStore.updateJob(jobId, patch)
}

async function updateJobStageFromOutput(jobStore, jobId, outputChunk) {
  const job = await jobStore.getJob(jobId)
  if (!job) return

  for (const rawLine of outputChunk.split(/\r?\n/)) {
    const text = rawLine.trim()
    if (!text) continue

    await setJobStage(jobStore, jobId, job.stage, job.progress ?? 10, text)

    if (text.includes('Starting') && text.includes('suite')) {
      await setJobStage(jobStore, jobId, 'Starting audit', 15, text)
    } else if (text.includes('Cleaning audit artifacts') || text.includes('Cleaning PDF reports')) {
      await setJobStage(jobStore, jobId, 'Preparing run files', 25, text)
    } else if (text.includes('Checking installed Playwright browsers')) {
      await setJobStage(jobStore, jobId, 'Checking browser dependencies', 35, text)
    } else if (text.includes('Installing missing Playwright browsers')) {
      await setJobStage(jobStore, jobId, 'Installing required browsers', 40, text)
    } else if (text.includes('Running Playwright')) {
      await setJobStage(jobStore, jobId, 'Running browser checks', 65, text)
    } else if (text.includes('Generating') && text.includes('PDF report')) {
      await setJobStage(jobStore, jobId, 'Generating PDF report', 85, text)
    } else if (text.includes('Pruning Playwright artifacts')) {
      await setJobStage(jobStore, jobId, 'Cleaning temporary artifacts', 92, text)
    } else if (text.includes('Regenerating report index')) {
      await setJobStage(jobStore, jobId, 'Finalizing report', 97, text)
    }
  }
}

function limiterFor(suite) {
  return suite === 'lighthouse' ? lighthouseLimit : generalLimit
}

export function enqueueAudit(jobId, auditRequest, options = {}) {
  const jobStore = options.jobStore ?? getJobStore()
  const fileStore = options.fileStore ?? getFileStore()
  const persistReports = options.persistReports ?? false

  limiterFor(auditRequest.suite)(() =>
    runAudit(jobId, auditRequest, {
      jobStore,
      fileStore,
      persistReports,
    }),
  ).catch(() => {})
}

export function getActiveJobCount(jobStore = getJobStore()) {
  return jobStore.getActiveJobCount()
}

export async function runAudit(jobId, auditRequest, options = {}) {
  const jobStore = options.jobStore ?? getJobStore()
  const fileStore = options.fileStore ?? getFileStore()
  const persistReports = options.persistReports ?? false
  const job = await jobStore.getJob(jobId)
  if (!job) return

  await jobStore.updateJob(jobId, {
    status: 'running',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  })

  let workDir = null

  try {
    await setJobStage(jobStore, jobId, 'Preparing workspace', 10)
    workDir = await mkdtemp(join(tmpdir(), 'audit-'))
    await jobStore.updateJob(jobId, { workDir })
    const project = getProjectInfo(auditRequest.url, jobId)

    await prepareAuditWorkspace(workDir, auditRequest, project, fileStore)
    await setJobStage(jobStore, jobId, 'Applying audit compatibility patches', 20)
    await ensureAuditKitPatched()
    await setJobStage(jobStore, jobId, 'Checking local browsers', 30)
    await ensurePlaywrightBrowsers()

    await spawnWithTimeout(
      AUDIT_KIT_BIN,
      [`report:${auditRequest.suite}-pdf:all`],
      {
        cwd: workDir,
        env: {
          ...process.env,
          BASE_URL: auditRequest.url,
          PLAYWRIGHT_WORKERS: '1',
        },
      },
      getAuditTimeoutMs(auditRequest.suite),
      (line) => {
        updateJobStageFromOutput(jobStore, jobId, line).catch(() => {})
      },
    )

    const reportFiles = await findReportFiles(workDir, project.projectDir, auditRequest.suite)

    if (persistReports) {
      const storedFiles = await fileStore.uploadReportFiles(jobId, reportFiles)
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
      const donePatch = {
        status: 'done',
        completedAt: Date.now(),
        updatedAt: Date.now(),
        workDir: null,
        pdfPath: null,
        reportFiles: storedFiles,
        stage: 'Report ready',
        progress: 100,
        lastMessage: 'Report ready',
        error: null,
      }
      const currentJob = await jobStore.getJob(jobId)
      await archiveProjectRun({ ...currentJob, id: jobId, ...donePatch }, storedFiles)
      await jobStore.markFinished(jobId, donePatch)
      return
    }

    const donePatch = {
      status: 'done',
      completedAt: Date.now(),
      updatedAt: Date.now(),
      pdfPath: reportFiles[0]?.path ?? null,
      reportFiles,
      stage: 'Report ready',
      progress: 100,
      lastMessage: 'Report ready',
      error: null,
    }
    const currentJob = await jobStore.getJob(jobId)
    await archiveProjectRun({ ...currentJob, id: jobId, ...donePatch }, reportFiles)
    await jobStore.markFinished(jobId, donePatch)
  } catch (error) {
    if (workDir) {
      rm(workDir, { recursive: true, force: true }).catch(() => {})
    }

    await jobStore.markFinished(jobId, {
      status: 'failed',
      completedAt: Date.now(),
      updatedAt: Date.now(),
      workDir: null,
      stage: 'Audit failed',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function findReportFiles(workDir, projectDir, suite) {
  const dir = join(workDir, 'qa-results', projectDir, 'reports', suite)
  const files = await readdir(dir)
  const pdfs = files
    .filter((fileName) => fileName.endsWith('.pdf'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => ({
      fileName,
      path: join(dir, fileName),
    }))

  if (pdfs.length === 0) {
    throw new Error('PDF not found in output directory')
  }

  return pdfs
}

function getProjectInfo(url, jobId) {
  const hostname = new URL(url).hostname.replace(/^www\./, '')
  const baseSlug = toSlug(hostname) || 'storefront-audit'

  return {
    projectName: hostname || 'Storefront Audit',
    projectDir: `${baseSlug}-${jobId.slice(0, 8)}`,
  }
}

function toSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function sanitizeFileName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

async function resolveUpload(upload, fileStore) {
  const buffer = await fileStore.getBuffer(upload)
  return {
    ...upload,
    buffer,
  }
}

async function buildPagesConfig(pages, uploads, fileStore) {
  const filesToWrite = []

  const normalizedPages = await Promise.all(
    pages.map(async (page, pageIndex) => {
      const normalizedPage = {
        name: page.name,
        url: page.url,
        components: await Promise.all(
          page.components.map(async (component, componentIndex) => {
            const normalizedComponent = {
              name: component.name,
              selector: component.selector,
            }

            if (component.referenceImageDesktopKey) {
              const desktopUpload = await resolveUpload(uploads[component.referenceImageDesktopKey], fileStore)
              const fileName = `desktop-${pageIndex + 1}-${componentIndex + 1}-${sanitizeFileName(desktopUpload.name)}`
              normalizedComponent.referenceImageDesktop = fileName
              filesToWrite.push({ device: 'desktop', fileName, buffer: desktopUpload.buffer })
            }

            if (component.referenceImageMobileKey) {
              const mobileUpload = await resolveUpload(uploads[component.referenceImageMobileKey], fileStore)
              const fileName = `mobile-${pageIndex + 1}-${componentIndex + 1}-${sanitizeFileName(mobileUpload.name)}`
              normalizedComponent.referenceImageMobile = fileName
              filesToWrite.push({ device: 'mobile', fileName, buffer: mobileUpload.buffer })
            }

            return normalizedComponent
          }),
        ),
      }

      if (Array.isArray(page.hideSelectors) && page.hideSelectors.length > 0) {
        normalizedPage.hideSelectors = page.hideSelectors
      }

      if (page.hideFixed === true) {
        normalizedPage.hideFixed = true
      }

      return normalizedPage
    }),
  )

  return {
    normalizedPages,
    filesToWrite,
  }
}

async function prepareAuditWorkspace(workDir, auditRequest, project, fileStore) {
  const configDir = join(workDir, 'configs')
  const referenceImagesDir = join(configDir, 'project-data', 'reference-images', project.projectDir)
  const { normalizedPages, filesToWrite } = await buildPagesConfig(
    auditRequest.pages,
    auditRequest.uploads,
    fileStore,
  )

  await mkdir(join(referenceImagesDir, 'desktop'), { recursive: true })
  await mkdir(join(referenceImagesDir, 'mobile'), { recursive: true })

  const envLines = [
    `BASE_URL=${auditRequest.url}`,
    `PROJECT_NAME=${project.projectName}`,
    `PROJECT_DIR=${project.projectDir}`,
  ]

  if (auditRequest.viewport?.desktop) {
    envLines.push(`DESKTOP_VIEWPORT_WIDTH=${auditRequest.viewport.desktop.width}`)
    envLines.push(`DESKTOP_VIEWPORT_HEIGHT=${auditRequest.viewport.desktop.height}`)
  }

  if (auditRequest.viewport?.mobile) {
    envLines.push(`MOBILE_VIEWPORT_WIDTH=${auditRequest.viewport.mobile.width}`)
    envLines.push(`MOBILE_VIEWPORT_HEIGHT=${auditRequest.viewport.mobile.height}`)
  }

  await writeFile(join(workDir, '.env'), `${envLines.join('\n')}\n`)
  await writeFile(join(configDir, 'playwright.pages.json'), `${JSON.stringify(normalizedPages, null, 2)}\n`)
  await writeFile(
    join(configDir, 'playwright.typography.json'),
    `${JSON.stringify(auditRequest.typography, null, 2)}\n`,
  )

  for (const file of filesToWrite) {
    await writeFile(join(referenceImagesDir, file.device, file.fileName), file.buffer)
  }
}

function ensureAuditKitPatched() {
  if (!auditKitPatchPromise) {
    auditKitPatchPromise = spawnWithTimeout(
      process.execPath,
      [AUDIT_KIT_PATCH_SCRIPT],
      { cwd: process.cwd() },
      BROWSER_SETUP_TIMEOUT_MS,
    ).catch((error) => {
      auditKitPatchPromise = null
      throw error
    })
  }

  return auditKitPatchPromise
}

function ensurePlaywrightBrowsers() {
  if (!playwrightInstallPromise) {
    playwrightInstallPromise = spawnWithTimeout(
      process.execPath,
      [PLAYWRIGHT_CLI, 'install', 'chromium', 'firefox', 'webkit'],
      { cwd: process.cwd() },
      BROWSER_SETUP_TIMEOUT_MS,
    ).catch((error) => {
      playwrightInstallPromise = null
      throw error
    })
  }

  return playwrightInstallPromise
}

function spawnWithTimeout(cmd, args, opts, timeoutMs, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, shell: false })
    const commandLabel = [cmd, ...args].join(' ')
    const chunks = []

    child.stdout?.on('data', (data) => {
      chunks.push(data)
      onOutput?.(data.toString('utf8'))
    })

    child.stderr?.on('data', (data) => {
      chunks.push(data)
      onOutput?.(data.toString('utf8'))
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Audit timed out after ${Math.round(timeoutMs / 60000)} minutes`))
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }

      const output = Buffer.concat(chunks).toString('utf8').trim()
      const detail = output ? `\n${output}` : ''
      reject(new Error(`Command failed with code ${code}: ${commandLabel}${detail}`))
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

setInterval(async () => {
  const cutoff = Date.now() - JOB_MAX_AGE_MS
  for (const [id, job] of globalState.jobMap.entries()) {
    if (job.createdAt >= cutoff) continue

    globalState.jobMap.delete(id)
    if (job.workDir) {
      rm(job.workDir, { recursive: true, force: true }).catch(() => {})
    }
  }
  await cleanupExpiredReports().catch(() => {})
}, SWEEP_INTERVAL_MS).unref()
