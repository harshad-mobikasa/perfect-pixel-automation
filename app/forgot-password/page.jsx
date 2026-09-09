'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setMessage('')

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to submit reset request')
      }
      setMessage(data.message ?? 'Ask an Admin or Project admin for a reset link.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit reset request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f5f2] text-[#3C3D41]">
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <form onSubmit={handleSubmit} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-[0_20px_60px_rgba(60,61,65,0.08)]">
          <Image src="/mobikasa.png" alt="Mobikasa" width={140} height={40} className="mb-6 h-10 w-auto" />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Mobikasa</p>
          <h1 className="mt-2 text-2xl font-semibold">Forgot password</h1>
          <p className="mt-2 text-sm text-[#3C3D41]/70">
            Enter your email. An Admin or Project admin can then send you a one-hour reset link from Manage users.
          </p>

          <label className="mt-6 block space-y-1">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-[#3C3D41]/15 px-3 py-3 outline-none focus:ring-2 focus:ring-[#F58220]"
            />
          </label>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {message && <p className="mt-4 text-sm text-[#3C3D41]">{message}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full rounded-xl bg-[#F58220] px-4 py-3 text-sm font-semibold text-white hover:bg-[#e27518] disabled:opacity-60 cursor-pointer"
          >
            {submitting ? 'Submitting…' : 'Continue'}
          </button>

          <p className="mt-4 text-center text-sm">
            <Link href="/login" className="text-[#F58220] hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
