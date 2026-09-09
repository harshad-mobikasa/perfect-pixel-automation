import { NextResponse } from 'next/server'
import { COOKIE_NAME, readSessionToken } from './lib/session.js'

function isPublicPath(pathname) {
  return (
    pathname === '/login' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/forgot-password' ||
    pathname === '/api/auth/reset-password' ||
    pathname === '/icon' ||
    pathname === '/favicon.ico' ||
    pathname === '/mobikasa.png'
  )
}

async function readSession(request) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  try {
    return await readSessionToken(token)
  } catch {
    return null
  }
}

export async function proxy(request) {
  const { pathname } = request.nextUrl
  const session = await readSession(request)

  if (isPublicPath(pathname)) {
    if (session && pathname === '/login') {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return NextResponse.next()
  }

  if (session) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.search = ''
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\.png$|.*\\.ico$|.*\\.svg$|.*\\.webp$).*)'],
}
