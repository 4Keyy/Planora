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
    <div className="flex min-h-screen items-center justify-center bg-transparent px-5 py-10 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
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
          <h1 className="text-2xl font-black tracking-tight text-gray-900">Reset password</h1>
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
              className="w-full rounded-2xl bg-gray-900 px-4 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-gray-900/10 transition-[background-color,transform] duration-200 hover:bg-gray-800 active:scale-[0.99]"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="fp-email" className="text-xs font-semibold uppercase tracking-wider text-gray-700">Email</label>
              <input
                id="fp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-[15px] text-gray-900 placeholder:text-gray-400 transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-gray-900 px-4 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-gray-900/10 transition-[background-color,opacity,transform] duration-200 hover:bg-gray-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
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
