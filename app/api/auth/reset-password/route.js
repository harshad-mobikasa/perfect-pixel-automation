import { setPasswordFromToken } from '../../../../lib/account-store.js'
import { jsonError } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : ''

  if (!token) {
    return Response.json({ error: 'Reset token is required' }, { status: 400 })
  }
  if (password !== confirmPassword) {
    return Response.json({ error: 'Passwords do not match' }, { status: 400 })
  }

  try {
    await setPasswordFromToken(token, password)
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error, 400)
  }
}
