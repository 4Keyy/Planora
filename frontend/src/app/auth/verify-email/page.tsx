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
    <div className="min-h-screen bg-transparent flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={TWEEN_DELIBERATE}
        className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white/90 p-6 shadow-soft-xl backdrop-blur-sm"
      >
        <div className="space-y-2 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Verify email</h1>
          <p className="text-sm text-gray-500">Paste your verification token.</p>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4 text-sm text-emerald-700">
              Email verified successfully.
            </div>
            <button
              onClick={() => router.push("/dashboard")}
              className="w-full h-11 rounded-xl bg-black text-white text-sm font-semibold hover:bg-gray-900 transition"
            >
              Go to dashboard
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Verification token</label>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token"
                className="w-full px-3.5 py-3 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-all placeholder:text-gray-400"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-xl bg-black text-white text-sm font-semibold hover:bg-gray-900 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {submitting ? "Verifying..." : "Verify email"}
            </button>
            <div className="text-center text-sm text-gray-500">
              <Link href="/profile" className="font-semibold text-gray-900 hover:underline">
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
