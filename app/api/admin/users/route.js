import { createUserRecord, getAccountStore, publicUser } from '../../../../lib/account-store.js'
import { jsonError, requireAdmin } from '../../../../lib/require-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const store = getAccountStore()
  const users = (await store.listUsers()).map(publicUser)
  return Response.json({ users })
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const store = getAccountStore()
    const user = await createUserRecord(store, {
      email: body?.email,
      password: body?.password,
      name: body?.name,
      role: body?.role ?? 'member',
      projectIds: body?.projectIds,
    })
    return Response.json({ user: publicUser(user) }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
