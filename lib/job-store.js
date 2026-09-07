// Singleton in-memory state — shared across all route handlers in this process.
// jobMap: jobId -> { status, createdAt, workDir, pdfPath, suite, error }
const jobMap = new Map()

// rateLimitMap: ip -> number[] (request timestamps)
const rateLimitMap = new Map()

export { jobMap, rateLimitMap }
