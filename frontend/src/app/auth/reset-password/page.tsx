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
    <div className="min-h-screen bg-transparent flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={TWEEN_DELIBERATE}
        className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white/90 p-6 shadow-soft-xl backdrop-blur-sm"
      >
        <div className="space-y-2 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Set new password</h1>
          <p className="text-sm text-gray-500">
            Paste the token from your email and choose a new password.
          </p>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4 text-sm text-emerald-700">
              Your password has been reset.
            </div>
            <button
              onClick={() => router.push("/auth/login")}
              className="w-full h-11 rounded-xl bg-black text-white text-sm font-semibold hover:bg-gray-900 transition"
            >
              Sign in
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Reset token</label>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token"
                autoComplete="off"
                className="w-full px-3.5 py-3 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-all placeholder:text-gray-400"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3.5 py-3 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-all placeholder:text-gray-400"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3.5 py-3 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-all placeholder:text-gray-400"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-xl bg-black text-white text-sm font-semibold hover:bg-gray-900 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {submitting ? "Saving..." : "Reset password"}
            </button>
            <div className="text-center text-sm text-gray-500">
              <Link href="/auth/login" className="font-semibold text-gray-900 hover:underline">
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
