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
        className="w-full max-w-sm rounded-3xl border border-gray-200/70 bg-white/75 p-6 shadow-[0_12px_44px_rgba(0,0,0,0.07)] backdrop-blur-xl sm:p-8"
      >
        <div className="mb-7 flex flex-col items-center gap-2.5 text-center">
          <span className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-gray-900" />
            <span className="text-lg font-black tracking-tight text-gray-900">Planora</span>
          </span>
        </div>
        <div className="space-y-1.5 mb-6">
          <h1 className="text-2xl font-black tracking-tight text-gray-900">Set new password</h1>
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
              className="w-full rounded-2xl bg-gray-900 px-4 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-gray-900/10 transition-[background-color,transform] duration-200 hover:bg-gray-800 active:scale-[0.99]"
            >
              Sign in
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="rp-token" className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Reset token</label>
              <input
                id="rp-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token"
                autoComplete="off"
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-[15px] text-gray-900 placeholder:text-gray-400 transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-password" className="text-xs font-semibold text-gray-700 uppercase tracking-wider">New password</label>
              <input
                id="rp-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-[15px] text-gray-900 placeholder:text-gray-400 transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-confirm" className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Confirm password</label>
              <input
                id="rp-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-[15px] text-gray-900 placeholder:text-gray-400 transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-gray-900 px-4 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-gray-900/10 transition-[background-color,opacity,transform] duration-200 hover:bg-gray-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
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
