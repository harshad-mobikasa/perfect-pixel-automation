'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to sign in')
      }
      router.replace('/')
      router.refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to sign in')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f5f2] text-[#3C3D41]">
      <div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
        <div className="hidden items-center justify-center bg-[#3C3D41] px-12 lg:flex">
          <div className="max-w-md">
            <div className="inline-flex rounded-2xl bg-white px-4 py-3">
              <Image src="/mobikasa.png" alt="Mobikasa" width={180} height={48} className="h-12 w-auto" />
            </div>
            <p className="mt-8 text-sm font-semibold uppercase tracking-[0.22em] text-[#F58220]">
              Internal platform
            </p>
            <h1 className="mt-3 text-4xl font-semibold text-white">
              Storefront audit workspace
            </h1>
            <p className="mt-4 text-base leading-7 text-white/70">
              Sign in to run Perfect Pixel, typography, SEO, Lighthouse, ADA, and responsive audits for Mobikasa projects.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center px-6 py-12">
          <form onSubmit={handleSubmit} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-[0_20px_60px_rgba(60,61,65,0.08)]">
            <Image src="/mobikasa.png" alt="Mobikasa" width={140} height={40} className="mb-6 h-10 w-auto lg:hidden" />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Mobikasa</p>
            <h2 className="mt-2 text-2xl font-semibold">Sign in</h2>
            <p className="mt-2 text-sm text-[#3C3D41]/70">
              This tool is limited to Mobikasa admins and assigned project users.
            </p>

            <label className="mt-6 block space-y-1">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-[#3C3D41]/15 px-3 py-3 outline-none focus:ring-2 focus:ring-[#F58220]"
              />
            </label>
            <label className="mt-4 block space-y-1">
              <span className="text-sm font-medium">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-[#3C3D41]/15 px-3 py-3 outline-none focus:ring-2 focus:ring-[#F58220]"
              />
            </label>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 w-full rounded-xl bg-[#F58220] px-4 py-3 text-sm font-semibold text-white hover:bg-[#e27518] disabled:opacity-60 cursor-pointer"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            <p className="mt-4 text-center text-sm">
              <Link href="/forgot-password" className="text-[#F58220] hover:underline">
                Forgot password?
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
