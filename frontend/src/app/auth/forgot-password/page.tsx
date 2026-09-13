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
          <h1 className="text-title font-bold tracking-tight text-ink">Reset password</h1>
          <p className="text-body-sm text-ink-subtle">
            Enter your email and we&apos;ll send a reset link.
          </p>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-positive-surface border border-positive-surface p-4 text-body-sm text-positive">
              If the email exists, a password reset link has been sent.
            </div>
            <button
              onClick={() => router.push("/auth/login")}
              className="w-full rounded-xl bg-gray-900 px-4 py-3.5 text-body-sm font-semibold text-paper shadow-lg shadow-gray-900/10 transition-[background-color,transform] duration-base hover:bg-gray-800 active:scale-[0.99]"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="fp-email" className="text-caption font-semibold uppercase tracking-wider text-ink-muted">Email</label>
              <input
                id="fp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-line bg-paper px-4 py-3.5 text-body-sm text-ink placeholder:text-ink-subtle transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-gray-900 px-4 py-3.5 text-body-sm font-semibold text-paper shadow-lg shadow-gray-900/10 transition-[background-color,opacity,transform] duration-base hover:bg-gray-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Send reset link"}
            </button>
            <div className="text-center text-body-sm text-ink-subtle">
              Remembered?{" "}
              <Link href="/auth/login" className="font-semibold text-ink hover:underline">
                Sign in
              </Link>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  )
}
