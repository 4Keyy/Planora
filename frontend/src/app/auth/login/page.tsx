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

// Shared auth-field styling. text-body-sm reads as 15px on desktop but is bumped to
// 16px on phones by globals.css (kills iOS focus-zoom); py-3.5 gives a ~52px touch
// target. rounded-xl + a soft focus ring match the rest of the mobile redesign.
const FIELD_CLS =
  "w-full rounded-xl border border-line bg-paper px-4 py-3.5 text-body-sm text-ink placeholder:text-ink-subtle transition-[border-color,box-shadow] focus:border-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-900/5"
const LABEL_CLS = "text-caption font-semibold uppercase tracking-wider text-ink-muted"

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
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 h-80 w-80 rounded-full bg-paper/5 blur-3xl" />

        <div className="relative z-10">
          <span className="text-paper font-bold text-title-sm tracking-tight">Planora</span>
        </div>

        <div className="relative z-10 space-y-6">
          <p className="text-display-sm font-bold text-paper leading-tight">
            Your tasks,<br />perfectly organized.
          </p>
          <p className="text-paper-subtle text-body leading-relaxed max-w-xs">
            Manage everything in one place with smart priorities, categories, and progress tracking.
          </p>

          <div className="flex flex-col gap-3 pt-2">
            {["Create tasks with priorities & due dates", "Organize with color-coded categories", "Track progress across all your projects"].map(text => (
              <div key={text} className="flex items-center gap-3 text-body-sm text-paper-muted">
                <div className="h-1.5 w-1.5 rounded-full bg-positive flex-shrink-0" />
                {text}
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-paper-subtle text-caption">
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
          className="w-full max-w-sm space-y-7 rounded-xl border border-line/70 bg-paper/75 p-6 shadow-[0_12px_44px_rgba(0,0,0,0.07)] backdrop-blur-xl sm:p-8 lg:space-y-8 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none"
        >
          {/* Header */}
          <div className="space-y-1.5">
            {/* Mobile brand lockup — phones drop the desktop's left panel, so re-introduce
                the wordmark + a one-line value prop here. Matches the navbar's dot lockup. */}
            <div className="mb-7 flex flex-col items-center gap-2.5 text-center lg:hidden">
              <span className="flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] rounded-full bg-gray-900" />
                <span className="text-title-sm font-bold tracking-tight text-ink">Planora</span>
              </span>
              <p className="text-caption font-medium text-ink-subtle">Real coordination for real life.</p>
            </div>
            <h1 className="text-title font-bold tracking-tight text-ink lg:font-bold">Sign in</h1>
            <p className="text-body-sm text-ink-subtle">Enter your credentials to continue</p>
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
              {errors.email && <p className="text-caption text-alert">{errors.email.message}</p>}
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
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-gray-100 hover:text-ink-muted"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-caption text-alert">{errors.password.message}</p>}
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

            <div className="flex items-center justify-between text-caption text-ink-subtle">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-line-strong"
                />
                Remember me
              </label>
              <Link href="/auth/forgot-password" className="hover:text-ink transition-colors">
                Forgot password?
              </Link>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={TWEEN_FAST}
                className="rounded-lg bg-alert-surface border border-alert-surface px-4 py-3 text-body-sm text-alert"
              >
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="group mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3.5 text-body-sm font-semibold text-paper shadow-lg shadow-gray-900/10 transition-[background-color,opacity,transform] duration-base hover:bg-gray-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
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
          <p className="text-body-sm text-ink-subtle text-center">
            Don&apos;t have an account?{" "}
            <Link href="/auth/register" className="font-semibold text-ink hover:underline">
              Create one
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  )
}
