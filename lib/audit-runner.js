import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import pLimit from 'p-limit'
import { jobMap } from './job-store.js'

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

function setJobStage(job, stage, progress, detail) {
  if (stage) {
    job.stage = stage
  }
  if (typeof progress === 'number') {
    job.progress = Math.max(job.progress ?? 0, progress)
  }
  if (detail) {
    job.lastMessage = detail
  }
  job.updatedAt = Date.now()
}

function updateJobStageFromOutput(job, outputChunk) {
  for (const rawLine of outputChunk.split(/\r?\n/)) {
    const text = rawLine.trim()
    if (!text) continue

    setJobStage(job, job.stage, job.progress ?? 10, text)

    if (text.includes('Starting') && text.includes('suite')) {
      setJobStage(job, 'Starting audit', 15, text)
    } else if (text.includes('Cleaning audit artifacts') || text.includes('Cleaning PDF reports')) {
      setJobStage(job, 'Preparing run files', 25, text)
    } else if (text.includes('Checking installed Playwright browsers')) {
      setJobStage(job, 'Checking browser dependencies', 35, text)
    } else if (text.includes('Installing missing Playwright browsers')) {
      setJobStage(job, 'Installing required browsers', 40, text)
    } else if (text.includes('Running Playwright')) {
      setJobStage(job, 'Running browser checks', 65, text)
    } else if (text.includes('Generating') && text.includes('PDF report')) {
      setJobStage(job, 'Generating PDF report', 85, text)
    } else if (text.includes('Pruning Playwright artifacts')) {
      setJobStage(job, 'Cleaning temporary artifacts', 92, text)
    } else if (text.includes('Regenerating report index')) {
      setJobStage(job, 'Finalizing report', 97, text)
    }
  }
}

function limiterFor(suite) {
  return suite === 'lighthouse' ? lighthouseLimit : generalLimit
}

export function enqueueAudit(jobId, auditRequest) {
  limiterFor(auditRequest.suite)(() => runAudit(jobId, auditRequest)).catch(() => {})
}

export function getActiveJobCount() {
  let count = 0
  for (const job of jobMap.values()) {
    if (job.status === 'queued' || job.status === 'running') count++
  }
  return count
}

async function runAudit(jobId, auditRequest) {
  const job = jobMap.get(jobId)
  if (!job) return

  job.status = 'running'
  job.startedAt = Date.now()
  let workDir = null

  try {
    setJobStage(job, 'Preparing workspace', 10)
    workDir = await mkdtemp(join(tmpdir(), 'audit-'))
    job.workDir = workDir
    const project = getProjectInfo(auditRequest.url, jobId)

    await prepareAuditWorkspace(workDir, auditRequest, project)
    setJobStage(job, 'Applying audit compatibility patches', 20)
    await ensureAuditKitPatched()
    setJobStage(job, 'Checking local browsers', 30)
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
      (line) => updateJobStageFromOutput(job, line),
    )

    const reportFiles = await findReportFiles(workDir, project.projectDir, auditRequest.suite)
    job.pdfPath = reportFiles[0]?.path ?? null
    job.reportFiles = reportFiles
    job.status = 'done'
    job.completedAt = Date.now()
    setJobStage(job, 'Report ready', 100)
  } catch (err) {
    job.status = 'failed'
    job.completedAt = Date.now()
    job.stage = 'Audit failed'
    job.error = err.message ?? 'Unknown error'
    if (workDir) {
      rm(workDir, { recursive: true, force: true }).catch(() => {})
      job.workDir = null
    }
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

function buildPagesConfig(pages, uploads) {
  const filesToWrite = []

  const normalizedPages = pages.map((page, pageIndex) => ({
    name: page.name,
    url: page.url,
    components: page.components.map((component, componentIndex) => {
      const normalizedComponent = {
        name: component.name,
        selector: component.selector,
      }

      if (component.referenceImageDesktopKey) {
        const desktopUpload = uploads[component.referenceImageDesktopKey]
        const fileName = `desktop-${pageIndex + 1}-${componentIndex + 1}-${sanitizeFileName(desktopUpload.name)}`
        normalizedComponent.referenceImageDesktop = fileName
        filesToWrite.push({ device: 'desktop', fileName, buffer: desktopUpload.buffer })
      }

      if (component.referenceImageMobileKey) {
        const mobileUpload = uploads[component.referenceImageMobileKey]
        const fileName = `mobile-${pageIndex + 1}-${componentIndex + 1}-${sanitizeFileName(mobileUpload.name)}`
        normalizedComponent.referenceImageMobile = fileName
        filesToWrite.push({ device: 'mobile', fileName, buffer: mobileUpload.buffer })
      }

      return normalizedComponent
    }),
  }))

  return {
    normalizedPages,
    filesToWrite,
  }
}

async function prepareAuditWorkspace(workDir, auditRequest, project) {
  const configDir = join(workDir, 'configs')
  const referenceImagesDir = join(
    configDir,
    'project-data',
    'reference-images',
    project.projectDir,
  )
  const { normalizedPages, filesToWrite } = buildPagesConfig(auditRequest.pages, auditRequest.uploads)

  await mkdir(join(referenceImagesDir, 'desktop'), { recursive: true })
  await mkdir(join(referenceImagesDir, 'mobile'), { recursive: true })

  await writeFile(
    join(workDir, '.env'),
    `BASE_URL=${auditRequest.url}\nPROJECT_NAME=${project.projectName}\nPROJECT_DIR=${project.projectDir}\n`,
  )

  await writeFile(
    join(configDir, 'playwright.pages.json'),
    `${JSON.stringify(normalizedPages, null, 2)}\n`,
  )

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
    ).catch((err) => {
      auditKitPatchPromise = null
      throw err
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
    ).catch((err) => {
      playwrightInstallPromise = null
      throw err
    })
  }

  return playwrightInstallPromise
}

function spawnWithTimeout(cmd, args, opts, timeoutMs, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, shell: false })
    const commandLabel = [cmd, ...args].join(' ')

    const chunks = []
    child.stdout?.on('data', (d) => {
      chunks.push(d)
      onOutput?.(d.toString('utf8'))
    })
    child.stderr?.on('data', (d) => {
      chunks.push(d)
      onOutput?.(d.toString('utf8'))
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Audit timed out after ${Math.round(timeoutMs / 60000)} minutes`))
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
      } else {
        const output = Buffer.concat(chunks).toString('utf8').trim()
        const detail = output ? `\n${output}` : ''
        reject(new Error(`Command failed with code ${code}: ${commandLabel}${detail}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

// Sweep stale jobs every 5 minutes
setInterval(async () => {
  const cutoff = Date.now() - JOB_MAX_AGE_MS
  for (const [id, job] of jobMap.entries()) {
    if (job.createdAt < cutoff) {
      jobMap.delete(id)
      if (job.workDir) {
        rm(job.workDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}, SWEEP_INTERVAL_MS).unref()