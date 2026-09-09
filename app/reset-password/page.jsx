'use client'

import { PasswordField } from '../../components/password-field.jsx'
import Image from 'next/image'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error ?? 'Unable to reset password')
      }
      router.replace('/login')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to reset password')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-[0_20px_60px_rgba(60,61,65,0.08)]">
      <Image src="/mobikasa.png" alt="Mobikasa" width={140} height={40} className="mb-6 h-10 w-auto" />
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F58220]">Mobikasa</p>
      <h1 className="mt-2 text-2xl font-semibold">Set a new password</h1>
      <p className="mt-2 text-sm text-[#3C3D41]/70">
        Use the reset link from your Admin or Project admin. Links expire after one hour.
      </p>

      <PasswordField
        className="mt-6"
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
      {!token && <p className="mt-4 text-sm text-red-600">This reset link is missing a token.</p>}

      <button
        type="submit"
        disabled={submitting || !token}
        className="mt-6 w-full rounded-xl bg-[#F58220] px-4 py-3 text-sm font-semibold text-white hover:bg-[#e27518] disabled:opacity-60 cursor-pointer"
      >
        {submitting ? 'Saving…' : 'Save password'}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f5f2] px-6 py-12 text-[#3C3D41]">
      <Suspense fallback={<p>Loading reset form…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
