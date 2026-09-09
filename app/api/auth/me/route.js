import { getSessionUser } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return Response.json({ error: 'Sign in required' }, { status: 401 })
  }

  return Response.json({ user })
}
