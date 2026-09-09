import { getFileStore } from '../../../../../../../lib/shopify-file-store.js'
import { getProjectReport } from '../../../../../../../lib/report-store.js'
import { requireUser } from '../../../../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function pickReportFile(files, requestedFile) {
  if (!Array.isArray(files) || files.length === 0) return null
  if (requestedFile) {
    return files.find((file) => file.fileName === requestedFile) ?? null
  }
  return files[0]
}

export async function GET(request, { params }) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  const { projectId, runId } = await params
  const requestedFile = new URL(request.url).searchParams.get('file')
  const report = await getProjectReport(auth.user, projectId, runId)

  if (report?.error === 'not-found') {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }
  if (!report) {
    return Response.json({ error: 'Report not found' }, { status: 404 })
  }

  const selectedReport = pickReportFile(report.files, requestedFile)
  if (!selectedReport) {
    return Response.json({ error: 'Report file not found' }, { status: 404 })
  }

  const downloadFileName = selectedReport.fileName ?? `${report.suite}-audit.pdf`
  const fileStore = getFileStore()
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
