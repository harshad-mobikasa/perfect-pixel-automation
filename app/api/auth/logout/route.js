import { cookies } from 'next/headers'
import { COOKIE_NAME, getSessionCookieOptions } from '../../../../lib/session.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, '', { ...getSessionCookieOptions(), maxAge: 0 })
  return Response.json({ ok: true })
}
