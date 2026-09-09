import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { getJobStore } from '../../../../../lib/job-store.js'
import { getFileStore } from '../../../../../lib/shopify-file-store.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function pickReportFile(reportFiles, requestedFile) {
  if (!Array.isArray(reportFiles) || reportFiles.length === 0) {
    return null
  }

  if (requestedFile) {
    return reportFiles.find((file) => file.fileName === requestedFile) ?? null
  }

  return reportFiles[0]
}

export async function GET(request, { params }) {
  const { jobId } = await params
  const requestUrl = new URL(request.url)
  const requestedFile = requestUrl.searchParams.get('file')
  const jobStore = getJobStore()
  const fileStore = getFileStore()
  const job = await jobStore.getJob(jobId)

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'done') {
    return Response.json({ error: `Job is not ready (status: ${job.status})` }, { status: 400 })
  }

  const { pdfPath, reportFiles, workDir, suite } = job
  const selectedReport = pickReportFile(reportFiles, requestedFile)
  const downloadFileName = selectedReport?.fileName ?? `${suite}-audit.pdf`
  const keepArtifactsForMoreDownloads = Boolean(
    requestedFile && Array.isArray(reportFiles) && reportFiles.length > 1,
  )

  if (selectedReport?.url || selectedReport?.fileId) {
    const downloadUrl = await fileStore.getDownloadUrl(selectedReport)
    if (!downloadUrl) {
      return Response.json({ error: 'Report file not found' }, { status: 404 })
    }

    const remoteResponse = await fetch(downloadUrl)
    if (!remoteResponse.ok) {
      return Response.json({ error: 'Failed to fetch report from Shopify Files' }, { status: 502 })
    }

    return new Response(remoteResponse.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${downloadFileName}"`,
      },
    })
  }

  const selectedPath = selectedReport?.path ?? pdfPath
  if (!selectedPath) {
    return Response.json({ error: 'Report file not found' }, { status: 404 })
  }

  if (!keepArtifactsForMoreDownloads) {
    await jobStore.deleteJob(jobId)
  }

  const fsStream = createReadStream(selectedPath)

  const webStream = new ReadableStream({
    start(controller) {
      fsStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)))
      fsStream.on('end', () => {
        controller.close()
        if (!keepArtifactsForMoreDownloads && workDir) {
          rm(workDir, { recursive: true, force: true }).catch(() => {})
        }
      })
      fsStream.on('error', (err) => {
        controller.error(err)
        if (!keepArtifactsForMoreDownloads && workDir) {
          rm(workDir, { recursive: true, force: true }).catch(() => {})
        }
      })
    },
    cancel() {
      fsStream.destroy()
      if (!keepArtifactsForMoreDownloads && workDir) {
        rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
    },
  })

  return new Response(webStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${downloadFileName}"`,
    },
  })
}
