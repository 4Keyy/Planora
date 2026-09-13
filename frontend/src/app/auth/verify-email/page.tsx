"use client"

import { Suspense, useCallback, useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { TWEEN_DELIBERATE } from "@/lib/animations"
import { api } from "@/lib/api"
import { refreshAccessToken } from "@/lib/auth-public"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"

function VerifyEmailContent() {
  const router = useRouter()
  const params = useSearchParams()
  const addToast = useToastStore((s) => s.addToast)
  const applyRefresh = useAuthStore((s) => s.applyRefresh)
  const [token, setToken] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [autoSubmittedToken, setAutoSubmittedToken] = useState<string | null>(null)

  const verifyToken = useCallback(async (value: string) => {
    const trimmedToken = value.trim()
    if (!trimmedToken) return
    setSubmitting(true)
    try {
      await api.get("/auth/api/v1/users/verify-email", { params: { token: trimmedToken } })
      try {
        const refreshed = await refreshAccessToken()
        applyRefresh(refreshed)
      } catch {
        // The verification link also works when opened outside an authenticated session.
      }
      setDone(true)
      addToast({ type: "success", title: "Email verified" })
    } catch {
      addToast({ type: "error", title: "Verification failed", description: "Check the token and try again." })
    } finally {
      setSubmitting(false)
    }
  }, [addToast, applyRefresh])

  useEffect(() => {
    const t = params.get("token") || params.get("verificationToken")
    if (!t) return

    setToken(t)
    if (autoSubmittedToken !== t && !done) {
      setAutoSubmittedToken(t)
      void verifyToken(t)
    }
  }, [autoSubmittedToken, done, params, verifyToken])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await verifyToken(token)
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
          <h1 className="text-title font-bold tracking-tight text-ink">Verify email</h1>
          <p className="text-body-sm text-ink-subtle">Paste your verification token.</p>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-positive-surface border border-positive-surface p-4 text-body-sm text-positive">
              Email verified successfully.
            </div>
            <button
              onClick={() => router.push("/dashboard")}
              className="w-full rounded-xl bg-gray-900 px-4 py-3.5 text-body-sm font-semibold text-paper shadow-lg shadow-gray-900/10 transition-[background-color,transform] duration-base hover:bg-gray-800 active:scale-[0.99]"
            >
              Go to dashboard
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="ve-token" className="text-caption font-semibold text-ink-muted uppercase tracking-wider">Verification token</label>
              <input
                id="ve-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token"
                className="w-full rounded-xl border border-line bg-paper px-4 py-3.5 text-body-sm text-ink placeholder:text-ink-subtle transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-gray-900 px-4 py-3.5 text-body-sm font-semibold text-paper shadow-lg shadow-gray-900/10 transition-[background-color,opacity,transform] duration-base hover:bg-gray-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Verifying..." : "Verify email"}
            </button>
            <div className="text-center text-body-sm text-ink-subtle">
              <Link href="/profile" className="font-semibold text-ink hover:underline">
                Back to profile
              </Link>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <VerifyEmailContent />
    </Suspense>
  )
}
