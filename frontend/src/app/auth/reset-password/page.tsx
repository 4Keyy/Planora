"use client"

import { Suspense, useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { TWEEN_DELIBERATE } from "@/lib/animations"
import { api } from "@/lib/api"
import { useToastStore } from "@/store/toast"

function ResetPasswordContent() {
  const router = useRouter()
  const params = useSearchParams()
  const addToast = useToastStore((s) => s.addToast)
  const [token, setToken] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const t = params.get("token") || params.get("resetToken")
    if (t) setToken(t)
  }, [params])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    if (password !== confirm) {
      addToast({ type: "error", title: "Passwords do not match" })
      return
    }
    setSubmitting(true)
    try {
      await api.post("/auth/api/v1/auth/reset-password", {
        resetToken: token,
        newPassword: password,
        confirmPassword: confirm,
      })
      setDone(true)
      addToast({ type: "success", title: "Password updated" })
    } catch {
      addToast({ type: "error", title: "Reset failed", description: "Check the token and try again." })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent px-5 py-10 sm:px-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, y: 0 }}
        transition={TWEEN_DELIBERATE}
        className="w-full max-w-sm rounded-xl border border-line/70 bg-paper/75 p-6 shadow-[0_12px_44px_rgba(0,0,0,0.07)] backdrop-blur-xl sm:p-8"
      >
        <div className="mb-7 flex flex-col items-center gap-2.5 text-center">
          <span className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-gray-900" />
            <span className="text-title-sm font-bold tracking-tight text-ink">Planora</span>
          </span>
        </div>
        <div className="space-y-1.5 mb-6">
          <h1 className="text-title font-bold tracking-tight text-ink">Set new password</h1>
          <p className="text-body-sm text-ink-subtle">
            Paste the token from your email and choose a new password.
          </p>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-positive-surface border border-positive-surface p-4 text-body-sm text-positive">
              Your password has been reset.
            </div>
            <button
              onClick={() => router.push("/auth/login")}
              className="w-full rounded-xl bg-gray-900 px-4 py-3.5 text-body-sm font-semibold text-paper shadow-lg shadow-gray-900/10 transition-[background-color,transform] duration-base hover:bg-gray-800 active:scale-[0.99]"
            >
              Sign in
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="rp-token" className="text-caption font-semibold text-ink-muted uppercase tracking-wider">Reset token</label>
              <input
                id="rp-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token"
                autoComplete="off"
                className="w-full rounded-xl border border-line bg-paper px-4 py-3.5 text-body-sm text-ink placeholder:text-ink-subtle transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-password" className="text-caption font-semibold text-ink-muted uppercase tracking-wider">New password</label>
              <input
                id="rp-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-xl border border-line bg-paper px-4 py-3.5 text-body-sm text-ink placeholder:text-ink-subtle transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-confirm" className="text-caption font-semibold text-ink-muted uppercase tracking-wider">Confirm password</label>
              <input
                id="rp-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-xl border border-line bg-paper px-4 py-3.5 text-body-sm text-ink placeholder:text-ink-subtle transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-gray-900 px-4 py-3.5 text-body-sm font-semibold text-paper shadow-lg shadow-gray-900/10 transition-[background-color,opacity,transform] duration-base hover:bg-gray-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Reset password"}
            </button>
            <div className="text-center text-body-sm text-ink-subtle">
              <Link href="/auth/login" className="font-semibold text-ink hover:underline">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ResetPasswordContent />
    </Suspense>
  )
}
