import { asPassword } from '../../../../lib/password.js'
import { changeOwnPassword } from '../../../../lib/account-store.js'
import { jsonError, requireUser } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    asPassword(body?.password)
    if (body?.password !== body?.confirmPassword) {
      throw new Error('Passwords do not match')
    }
    await changeOwnPassword(auth.user, body?.currentPassword, body.password)
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
