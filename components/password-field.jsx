'use client'

import { useState } from 'react'

function PasswordField({
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  disabled = false,
  className = 'mt-4',
}) {
  const [visible, setVisible] = useState(false)

  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-sm font-medium">{label}</span>
      <span className="relative block">
        <input
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className="w-full rounded-xl border border-[#3C3D41]/15 px-3 py-3 pr-12 outline-none focus:ring-2 focus:ring-[#F58220]"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-[#3C3D41]/60 hover:text-[#3C3D41] cursor-pointer"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 3l18 18" strokeLinecap="round" />
              <path d="M10.6 10.7a2 2 0 002.8 2.8" strokeLinecap="round" />
              <path d="M9.9 5.2A10.5 10.5 0 0121 12c-.6 1-1.4 2-2.3 2.8M6.1 6.2C4.4 7.5 3 9.2 2 12c1.7 4.5 6 7.5 10 7.5 1.6 0 3.2-.4 4.6-1.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 12s3.5-7.5 10-7.5S22 12 22 12s-3.5 7.5-10 7.5S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </span>
    </label>
  )
}

function GeneratedPasswordReveal({ password }) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-[#F58220]/30 bg-white px-4 py-3 text-sm">
      <p className="font-medium">Generated password — send this yourself</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type={visible ? 'text' : 'password'}
          value={password}
          readOnly
          className="min-w-0 flex-1 rounded-lg border border-[#3C3D41]/15 bg-[#f7f5f2] px-3 py-2 font-mono text-[#3C3D41] outline-none"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#3C3D41]/15 text-[#3C3D41]/70 hover:text-[#3C3D41] cursor-pointer"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 3l18 18" strokeLinecap="round" />
              <path d="M10.6 10.7a2 2 0 002.8 2.8" strokeLinecap="round" />
              <path d="M9.9 5.2A10.5 10.5 0 0121 12c-.6 1-1.4 2-2.3 2.8M6.1 6.2C4.4 7.5 3 9.2 2 12c1.7 4.5 6 7.5 10 7.5 1.6 0 3.2-.4 4.6-1.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 12s3.5-7.5 10-7.5S22 12 22 12s-3.5 7.5-10 7.5S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={copyPassword}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#3C3D41]/15 text-[#3C3D41]/70 hover:text-[#3C3D41] cursor-pointer"
          aria-label="Copy password"
        >
          {copied ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5h10" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
      <p className="mt-2 text-xs text-[#3C3D41]/60">
        {copied
          ? 'Copied. Send it yourself — it will disappear shortly.'
          : 'Copy it now. It hides after a few seconds, or when you leave this page.'}
      </p>
    </div>
  )
}

export { GeneratedPasswordReveal, PasswordField }
