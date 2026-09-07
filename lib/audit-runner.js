import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import pLimit from 'p-limit'
import { jobMap } from './job-store.js'

const generalLimit = pLimit(2)
const lighthouseLimit = pLimit(1)

const TIMEOUT_MS = 5 * 60 * 1000
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const JOB_MAX_AGE_MS = 30 * 60 * 1000
const AUDIT_KIT_BIN = join(process.cwd(), 'node_modules', '.bin', 'audit-kit')
const AUDIT_KIT_PATCH_SCRIPT = join(process.cwd(), 'scripts', 'patch-audit-kit.mjs')
const PLAYWRIGHT_CLI = join(process.cwd(), 'node_modules', 'playwright', 'cli.js')

let playwrightInstallPromise = null
let auditKitPatchPromise = null

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
  let workDir = null

  try {
    workDir = await mkdtemp(join(tmpdir(), 'audit-'))
    job.workDir = workDir
    const project = getProjectInfo(auditRequest.url, jobId)

    await prepareAuditWorkspace(workDir, auditRequest, project)
    await ensureAuditKitPatched()
    await ensurePlaywrightBrowsers()

    await spawnWithTimeout(
      AUDIT_KIT_BIN,
      [`report:${auditRequest.suite}-pdf:all`],
      { cwd: workDir },
      TIMEOUT_MS,
    )

    const pdfPath = await findPdf(workDir, project.projectDir, auditRequest.suite)
    job.pdfPath = pdfPath
    job.status = 'done'
  } catch (err) {
    job.status = 'failed'
    job.error = err.message ?? 'Unknown error'
    if (workDir) {
      rm(workDir, { recursive: true, force: true }).catch(() => {})
      job.workDir = null
    }
  }
}

async function findPdf(workDir, projectDir, suite) {
  const dir = join(workDir, 'qa-results', projectDir, 'reports', suite)
  const files = await readdir(dir)
  const pdf = files.find((f) => f.endsWith('.pdf'))
  if (!pdf) throw new Error('PDF not found in output directory')
  return join(dir, pdf)
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
      TIMEOUT_MS,
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
      TIMEOUT_MS,
    ).catch((err) => {
      playwrightInstallPromise = null
      throw err
    })
  }

  return playwrightInstallPromise
}

function spawnWithTimeout(cmd, args, opts, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, shell: false })
    const commandLabel = [cmd, ...args].join(' ')

    const chunks = []
    child.stdout?.on('data', (d) => chunks.push(d))
    child.stderr?.on('data', (d) => chunks.push(d))

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Audit timed out after 5 minutes'))
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