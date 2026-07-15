"use client"

import { useState, useEffect } from "react"
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
import { getLoginErrorMessage, isTwoFactorChallenge } from "@/lib/errors"
import type { AuthLoginResponse } from "@/types/auth"

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Minimum 6 characters"),
})
type FormData = z.infer<typeof schema>

// Shared auth-field styling. text-[15px] reads as 15px on desktop but is bumped to
// 16px on phones by globals.css (kills iOS focus-zoom); py-3.5 gives a ~52px touch
// target. rounded-2xl + a soft focus ring match the rest of the mobile redesign.
const FIELD_CLS =
  "w-full rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-[15px] text-gray-900 placeholder:text-gray-400 transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
const LABEL_CLS = "text-xs font-semibold uppercase tracking-wider text-gray-700"

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore(s => s.setAuth)
  const addToast = useToastStore(s => s.addToast)
  const hasHydrated = useAuthStore(s => s.hasHydrated)
  const hasRestoredSession = useAuthStore(s => s.hasRestoredSession)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPass, setShowPass] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState("")
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (hasHydrated && hasRestoredSession && isAuthenticated) {
      router.replace('/dashboard')
    }
  }, [hasHydrated, hasRestoredSession, isAuthenticated, router])

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setSubmitting(true); setError(null)
    try {
      const res = await api.post<AuthLoginResponse>("/auth/api/v1/auth/login", {
        email: data.email,
        password: data.password,
        rememberMe,
        twoFactorCode: requiresTwoFactor ? twoFactorCode : undefined,
      })
      const p = parseApiResponse<AuthLoginResponse>(res.data)
      setAuth({
        userId: p.userId,
        email: p.email,
        firstName: p.firstName,
        lastName: p.lastName,
        profilePictureUrl: p.profilePictureUrl,
        accessToken: p.accessToken,
        refreshTokenExpiresAt: p.expiresAt,
      })
      addToast({ type: "success", title: "Welcome back!" })
      router.push("/dashboard")
    } catch (err: unknown) {
      const needsTwoFactor = isTwoFactorChallenge(err)
      const msg = needsTwoFactor
        ? (requiresTwoFactor ? "Invalid two-factor code." : "Enter your two-factor code to continue.")
        : getLoginErrorMessage(err)
      if (needsTwoFactor) {
        setRequiresTwoFactor(true)
      } else {
        setRequiresTwoFactor(false)
      }
      setError(msg)
      addToast({ type: "error", title: "Sign in failed", description: msg })
    } finally { setSubmitting(false) }
  }

  if (!hasHydrated || !hasRestoredSession) {
    return <div className="min-h-screen bg-transparent" />
  }

  return (
    <div className="min-h-screen bg-transparent flex">
      {/* Left panel — decorative */}
      <div className="hidden lg:flex lg:w-1/2 bg-gray-900 flex-col justify-between p-12 relative overflow-hidden">
        {/* Grid bg */}
        <div className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: "40px 40px"
          }}
        />
        {/* Glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 h-80 w-80 rounded-full bg-white/5 blur-3xl" />

        <div className="relative z-10">
          <span className="text-white font-bold text-lg tracking-tight">Planora</span>
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">
            Your tasks,<br />perfectly organized.
          </h2>
          <p className="text-gray-400 text-base leading-relaxed max-w-xs">
            Manage everything in one place with smart priorities, categories, and progress tracking.
          </p>

          <div className="flex flex-col gap-3 pt-2">
            {["Create tasks with priorities & due dates", "Organize with color-coded categories", "Track progress across all your projects"].map(text => (
              <div key={text} className="flex items-center gap-3 text-sm text-gray-400">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                {text}
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-gray-600 text-xs">
            © {mounted ? new Date().getFullYear() : "2026"} Planora
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-6 lg:px-4 lg:py-12">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={TWEEN_DELIBERATE}
          className="w-full max-w-sm space-y-7 rounded-3xl border border-gray-200/70 bg-white/75 p-6 shadow-[0_12px_44px_rgba(0,0,0,0.07)] backdrop-blur-xl sm:p-8 lg:space-y-8 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none"
        >
          {/* Header */}
          <div className="space-y-1.5">
            {/* Mobile brand lockup — phones drop the desktop's left panel, so re-introduce
                the wordmark + a one-line value prop here. Matches the navbar's dot lockup. */}
            <div className="mb-7 flex flex-col items-center gap-2.5 text-center lg:hidden">
              <span className="flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] rounded-full bg-gray-900" />
                <span className="text-lg font-black tracking-tight text-gray-900">Planora</span>
              </span>
              <p className="text-[13px] font-medium text-gray-400">Real coordination for real life.</p>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900 lg:font-bold">Sign in</h1>
            <p className="text-sm text-gray-500">Enter your credentials to continue</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-email" className={LABEL_CLS}>Email</label>
              <input
                {...register("email")}
                id="login-email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                className={FIELD_CLS}
              />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className={LABEL_CLS}>Password</label>
              <div className="relative">
                <input
                  {...register("password")}
                  id="login-password"
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className={`${FIELD_CLS} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  tabIndex={-1}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>

            {requiresTwoFactor && (
              <div className="space-y-1.5">
                <label htmlFor="login-2fa" className={LABEL_CLS}>2FA Code</label>
                <input
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  id="login-2fa"
                  inputMode="numeric"
                  placeholder="123456"
                  className={FIELD_CLS}
                />
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-gray-500">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Remember me
              </label>
              <Link href="/auth/forgot-password" className="hover:text-gray-900 transition-colors">
                Forgot password?
              </Link>
            </div>

            {/* Error */}
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
                  Signing in...
                </span>
              ) : (
                <>Sign in <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>
              )}
            </button>
          </form>

          {/* Footer link */}
          <p className="text-sm text-gray-500 text-center">
            Don&apos;t have an account?{" "}
            <Link href="/auth/register" className="font-semibold text-gray-900 hover:underline">
              Create one
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  )
}
