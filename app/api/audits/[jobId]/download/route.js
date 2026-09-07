import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { jobMap } from '../../../../../lib/job-store.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { jobId } = await params
  const requestUrl = new URL(request.url)
  const requestedFile = requestUrl.searchParams.get('file')
  const job = jobMap.get(jobId)

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'done') {
    return Response.json({ error: `Job is not ready (status: ${job.status})` }, { status: 400 })
  }

  const { pdfPath, reportFiles, workDir, suite } = job
  const selectedReport =
    requestedFile && Array.isArray(reportFiles)
      ? reportFiles.find((file) => file.fileName === requestedFile)
      : null
  const selectedPath = selectedReport?.path ?? pdfPath
  const downloadFileName = selectedReport?.fileName ?? `${suite}-audit.pdf`
  const keepArtifactsForMoreDownloads = Boolean(
    requestedFile && Array.isArray(reportFiles) && reportFiles.length > 1,
  )

  // Remove from map immediately — download is one-shot
  if (!selectedPath) {
    return Response.json({ error: 'Report file not found' }, { status: 404 })
  }

  if (!keepArtifactsForMoreDownloads) {
    jobMap.delete(jobId)
  }

  const fsStream = createReadStream(selectedPath)

  const webStream = new ReadableStream({
    start(controller) {
      fsStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)))
      fsStream.on('end', () => {
        controller.close()
        if (!keepArtifactsForMoreDownloads) {
          if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
        }
      })
      fsStream.on('error', (err) => {
        controller.error(err)
        if (!keepArtifactsForMoreDownloads) {
          if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
        }
      })
    },
    cancel() {
      fsStream.destroy()
      if (!keepArtifactsForMoreDownloads) {
        if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
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
