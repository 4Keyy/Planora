"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Eye, EyeOff, ArrowRight } from "lucide-react"
import Link from "next/link"
import { motion } from "framer-motion"
import { TWEEN_DELIBERATE, TWEEN_FAST } from "@/lib/animations"
import { api, parseApiResponse } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { getRegisterErrorMessage } from "@/lib/errors"
import type { AuthRegisterResponse } from "@/types/auth"

const schema = z.object({
  firstName: z.string().min(2, "At least 2 characters"),
  lastName: z.string().min(2, "At least 2 characters"),
  email: z.string().email("Invalid email"),
  password: z.string()
    .min(8, "At least 8 characters")
    .regex(/[A-Z]/, "Needs uppercase")
    .regex(/[a-z]/, "Needs lowercase")
    .regex(/[0-9]/, "Needs a number")
    .regex(/[^A-Za-z0-9]/, "Needs special character"),
  confirmPassword: z.string().min(6),
}).refine(d => d.password === d.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] })

type FormData = z.infer<typeof schema>

function InputField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  // The wrapping <label> implicitly associates the text with the nested control, so screen
  // readers announce the field name on focus (a bare sibling <label> is not associated).
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">{label}</span>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </label>
  )
}

// text-[15px] is bumped to 16px on phones by globals.css (no iOS focus-zoom); py-3.5
// gives a ~52px touch target. Matches the login screen's field styling.
const inputClass = "w-full rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-[15px] text-gray-900 placeholder:text-gray-400 transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"

export default function RegisterPage() {
  const router = useRouter()
  const setAuth = useAuthStore(s => s.setAuth)
  const addToast = useToastStore(s => s.addToast)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })
  const password = watch("password") || ""

  const strength = useMemo(() => {
    if (!password) return null
    let s = 0
    if (password.length >= 8) s++
    if (password.length >= 12) s++
    if (/[a-z]/.test(password)) s++
    if (/[A-Z]/.test(password)) s++
    if (/[0-9]/.test(password)) s++
    if (/[^A-Za-z0-9]/.test(password)) s++
    const pct = Math.round((s / 6) * 100)
    const label = pct < 40 ? "Weak" : pct < 70 ? "Fair" : pct < 90 ? "Good" : "Strong"
    const color = pct < 40 ? "#ef4444" : pct < 70 ? "#f97316" : pct < 90 ? "#eab308" : "#10b981"
    return { pct, label, color }
  }, [password])

  const onSubmit = async (data: FormData) => {
    setSubmitting(true); setError(null)
    try {
      const res = await api.post<AuthRegisterResponse>("/auth/api/v1/auth/register", data)
      const p = parseApiResponse<AuthRegisterResponse>(res.data)
      setAuth({
        userId: p.userId,
        email: p.email,
        firstName: p.firstName,
        lastName: p.lastName,
        accessToken: p.accessToken,
        refreshTokenExpiresAt: p.expiresAt,
      })
      try {
        sessionStorage.setItem("planora-first-run", "1")
      } catch {
        // Ignore storage failures; onboarding copy still appears through the empty state.
      }
      addToast({ type: "success", title: "Account created", description: "Start by adding your first task." })
      router.push("/dashboard")
    } catch (err: unknown) {
      const msg = getRegisterErrorMessage(err)
      setError(msg)
      addToast({ type: "error", title: "Registration failed", description: msg })
    } finally { setSubmitting(false) }
  }

  return (
    <div className="min-h-screen bg-transparent flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gray-900 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`, backgroundSize: "40px 40px" }}
        />
        <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-white/5 blur-3xl" />

        <div className="relative z-10">
          <span className="text-white font-bold text-lg tracking-tight">Planora</span>
        </div>

        <div className="relative z-10 space-y-6">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Start your workspace</div>
            <h2 className="text-4xl font-bold text-white leading-tight">
              Start managing<br />your life better.
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { num: "Tasks", label: "Prioritized" },
              { num: "Categories", label: "Organized" },
              { num: "Dates", label: "Scheduled" },
              { num: "Private", label: "By default" },
            ].map(s => (
              <div key={s.label} className="rounded-xl bg-white/5 border border-white/10 p-4">
                <div className="text-xl font-bold text-white">{s.num}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-gray-600 text-xs">© {mounted ? new Date().getFullYear() : "2026"} Planora</p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-6 lg:px-4 lg:py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={TWEEN_DELIBERATE}
          className="w-full max-w-sm space-y-7 rounded-3xl border border-gray-200/70 bg-white/75 p-6 shadow-[0_12px_44px_rgba(0,0,0,0.07)] backdrop-blur-xl sm:p-8 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none"
        >
          <div className="space-y-1.5">
            {/* Mobile brand lockup — matches the login screen (phones drop the left panel). */}
            <div className="mb-7 flex flex-col items-center gap-2.5 text-center lg:hidden">
              <span className="flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] rounded-full bg-gray-900" />
                <span className="text-lg font-black tracking-tight text-gray-900">Planora</span>
              </span>
              <p className="text-[13px] font-medium text-gray-400">Real coordination for real life.</p>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900 lg:font-bold">Create account</h1>
            <p className="text-sm text-gray-500">Free, forever. No credit card required.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <InputField label="First name" error={errors.firstName?.message}>
                <input {...register("firstName")} placeholder="Jane" autoComplete="given-name" className={inputClass} />
              </InputField>
              <InputField label="Last name" error={errors.lastName?.message}>
                <input {...register("lastName")} placeholder="Doe" autoComplete="family-name" className={inputClass} />
              </InputField>
            </div>

            <InputField label="Email" error={errors.email?.message}>
              <input {...register("email")} type="email" placeholder="you@example.com" autoComplete="email" className={inputClass} />
            </InputField>

            <InputField label="Password" error={errors.password?.message}>
              <div className="relative">
                <input
                  {...register("password")}
                  type={showPass ? "text" : "password"}
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                  className={inputClass + " pr-12"}
                />
                <button type="button" onClick={() => setShowPass(!showPass)} tabIndex={-1}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {/* Strength meter */}
              {strength && (
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width,background-color] duration-500"
                      style={{ width: `${strength.pct}%`, backgroundColor: strength.color }}
                    />
                  </div>
                  <p className="text-xs" style={{ color: strength.color }}>{strength.label}</p>
                </div>
              )}
            </InputField>

            <InputField label="Confirm password" error={errors.confirmPassword?.message}>
              <div className="relative">
                <input
                  {...register("confirmPassword")}
                  type={showConfirm ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className={inputClass + " pr-12"}
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} tabIndex={-1}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </InputField>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={TWEEN_FAST}
                className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600"
              >
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="group mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-gray-900/10 transition-[background-color,opacity,transform] duration-200 hover:bg-gray-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating account...
                </span>
              ) : (
                <>Create account <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>
              )}
            </button>
          </form>

          <p className="text-sm text-gray-500 text-center">
            Already have an account?{" "}
            <Link href="/auth/login" className="font-semibold text-gray-900 hover:underline">Sign in</Link>
          </p>
        </motion.div>
      </div>
    </div>
  )
}
