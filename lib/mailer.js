import nodemailer from 'nodemailer'

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required to send email`)
  }
  return value
}

function getSmtpConfig() {
  return {
    host: requiredEnv('SMTP_HOST'),
    port: Number.parseInt(process.env.SMTP_PORT || '587', 10),
    user: requiredEnv('SMTP_USER'),
    pass: requiredEnv('SMTP_PASS'),
    from: process.env.EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim(),
  }
}

function createTransport() {
  const config = getSmtpConfig()
  return nodemailer.createTransport({
    host: config.host,
    port: Number.isFinite(config.port) ? config.port : 587,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  })
}

function getAppBaseUrl(request) {
  const configured = process.env.APP_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  const proto = request?.headers?.get('x-forwarded-proto') ?? 'http'
  const host = request?.headers?.get('x-forwarded-host') ?? request?.headers?.get('host')
  if (!host) {
    throw new Error('APP_BASE_URL is required to create email links')
  }
  return `${proto}://${host}`.replace(/\/+$/, '')
}

function buildPasswordUrl(request, token) {
  const url = new URL('/reset-password', getAppBaseUrl(request))
  url.searchParams.set('token', token)
  return url.toString()
}

function buildAuditDownloadUrl(jobId, fileName) {
  const url = new URL(`/api/audits/${jobId}/download`, getAppBaseUrl())
  if (fileName) url.searchParams.set('file', fileName)
  return url.toString()
}

function textForInvite({ name, link, expiresInHours }) {
  return `Hi ${name},

You have been invited to the Mobikasa Storefront Audit workspace.

Set your password using this secure link:
${link}

This link expires in ${expiresInHours} hours. If you did not expect this invite, you can ignore this email.
`
}

function textForPasswordReset({ name, link, expiresInHours }) {
  return `Hi ${name},

We received a request to reset your Mobikasa Storefront Audit password.

Set a new password using this secure link:
${link}

This link expires in ${expiresInHours} hour${expiresInHours === 1 ? '' : 's'}. If you did not request this, you can ignore this email.
`
}

function textForAuditResult({ name, projectName, suite, status, reportFiles, error, jobId }) {
  const title = status === 'done' ? 'Your report is ready' : 'Your audit could not be completed'
  const lines = [
    `Hi ${name},`,
    '',
    title,
    '',
    `Project: ${projectName}`,
    `Audit type: ${suite}`,
    `Status: ${status === 'done' ? 'Completed' : 'Failed'}`,
  ]

  if (status === 'done') {
    lines.push('', 'Report links:')
    for (const file of reportFiles) {
      lines.push(`- ${file.fileName}: ${buildAuditDownloadUrl(jobId, file.fileName)}`)
    }
  } else {
    lines.push('', `Error: ${String(error || 'The audit failed').slice(0, 500)}`)
  }

  lines.push('', 'You can also open the audit tool and check the project reports section.')
  return lines.join('\n')
}

async function sendMail({ to, subject, text }) {
  const config = getSmtpConfig()
  const transporter = createTransport()
  await transporter.sendMail({
    from: config.from,
    to,
    subject,
    text,
  })
}

async function sendInviteEmail({ to, name, link, expiresInHours }) {
  await sendMail({
    to,
    subject: 'You are invited to Mobikasa Storefront Audit',
    text: textForInvite({ name, link, expiresInHours }),
  })
}

async function sendPasswordResetEmail({ to, name, link, expiresInHours }) {
  await sendMail({
    to,
    subject: 'Reset your Mobikasa Storefront Audit password',
    text: textForPasswordReset({ name, link, expiresInHours }),
  })
}

async function sendAuditResultEmail({ to, name, projectName, suite, status, reportFiles = [], error, jobId }) {
  await sendMail({
    to,
    subject:
      status === 'done'
        ? `${suite} report generated for ${projectName}`
        : `${suite} audit failed for ${projectName}`,
    text: textForAuditResult({ name, projectName, suite, status, reportFiles, error, jobId }),
  })
}

export { buildPasswordUrl, getAppBaseUrl, sendAuditResultEmail, sendInviteEmail, sendPasswordResetEmail }
