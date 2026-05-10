"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { TWEEN_DELIBERATE } from "@/lib/animations"
import { api } from "@/lib/api"
import { useToastStore } from "@/store/toast"

export default function ForgotPasswordPage() {
  const router = useRouter()
  const addToast = useToastStore((s) => s.addToast)
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    try {
      await api.post("/auth/api/v1/auth/request-password-reset", { email })
      setDone(true)
      addToast({ type: "success", title: "Check your email", description: "If the address exists, a reset link was sent." })
    } catch {
      addToast({ type: "error", title: "Request failed", description: "Please try again in a moment." })
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
          <h1 className="text-2xl font-bold text-gray-900">Reset password</h1>
          <p className="text-sm text-gray-500">
            Enter your email and we&apos;ll send a reset link.
          </p>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4 text-sm text-emerald-700">
              If the email exists, a password reset link has been sent.
            </div>
            <button
              onClick={() => router.push("/auth/login")}
              className="w-full h-11 rounded-xl bg-black text-white text-sm font-semibold hover:bg-gray-900 transition"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3.5 py-3 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-all placeholder:text-gray-400"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-xl bg-black text-white text-sm font-semibold hover:bg-gray-900 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {submitting ? "Sending..." : "Send reset link"}
            </button>
            <div className="text-center text-sm text-gray-500">
              Remembered?{" "}
              <Link href="/auth/login" className="font-semibold text-gray-900 hover:underline">
                Sign in
              </Link>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  )
}
