import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { jobMap } from '../../../../../lib/job-store.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { jobId } = await params
  const job = jobMap.get(jobId)

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'done') {
    return Response.json({ error: `Job is not ready (status: ${job.status})` }, { status: 400 })
  }

  const { pdfPath, workDir, suite } = job

  // Remove from map immediately — download is one-shot
  jobMap.delete(jobId)

  const fsStream = createReadStream(pdfPath)

  const webStream = new ReadableStream({
    start(controller) {
      fsStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)))
      fsStream.on('end', () => {
        controller.close()
        if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
      })
      fsStream.on('error', (err) => {
        controller.error(err)
        if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
      })
    },
    cancel() {
      fsStream.destroy()
      if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
    },
  })

  return new Response(webStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${suite}-audit.pdf"`,
    },
  })
}
