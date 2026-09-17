'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PasswordField } from '../../components/password-field.jsx'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [token] = useState(() =>
    typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('token') ?? '',
  )
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setNotice('')

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to set password')
      }
      setNotice('Password updated. Redirecting to sign in...')
      window.setTimeout(() => router.replace('/login'), 1200)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to set password')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f5f2] text-[#3C3D41]">
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <form onSubmit={handleSubmit} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-[0_20px_60px_rgba(60,61,65,0.08)]">
          <Image src="/mobikasa.png" alt="Mobikasa" width={140} height={40} className="mb-6 h-10 w-auto" />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Mobikasa</p>
          <h1 className="mt-2 text-2xl font-semibold">Set password</h1>
          <p className="mt-2 text-sm text-[#3C3D41]/70">
            Enter a new password for your account. Passwords must be between 10 and 128 characters.
          </p>

          {!token && (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              This password link is missing a token. Open the link from your email again.
            </p>
          )}

          <PasswordField
            label="New password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <PasswordField
            label="Confirm password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {notice && <p className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-700">{notice}</p>}

          <button
            type="submit"
            disabled={submitting || !token}
            className="mt-6 w-full rounded-xl bg-[#F58220] px-4 py-3 text-sm font-semibold text-white hover:bg-[#e27518] disabled:opacity-60 cursor-pointer"
          >
            {submitting ? 'Saving...' : 'Set password'}
          </button>
          <Link href="/login" className="mt-4 block text-center text-sm font-medium text-[#F58220] hover:underline">
            Back to sign in
          </Link>
        </form>
      </div>
    </div>
  )
}
