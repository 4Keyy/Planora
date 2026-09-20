"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { api, parseApiResponse } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { getLoginErrorMessage, isTwoFactorChallenge } from "@/lib/errors"
import type { AuthLoginResponse } from "@/types/auth"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PasswordInput } from "@/components/auth/password-input"
import { AuthBanner, AuthBrand, AuthPanel } from "@/components/auth/auth-chrome"
import { PASSWORD_SCHEMA } from "@/lib/password-policy"

const schema = z.object({
  email: z.string().email("Invalid email"),
  // The same policy the account was created under. Accepting a weaker password here
  // than register can produce means the sign-in form advertises a shape of password
  // that cannot exist.
  password: PASSWORD_SCHEMA,
})
type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const addToast = useToastStore((s) => s.addToast)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const hasRestoredSession = useAuthStore((s) => s.hasRestoredSession)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rememberMe, setRememberMe] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState("")
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null)
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false)

  useEffect(() => {
    if (hasHydrated && hasRestoredSession && isAuthenticated) {
      router.replace("/dashboard")
    }
  }, [hasHydrated, hasRestoredSession, isAuthenticated, router])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setSubmitting(true)
    setError(null)
    setTwoFactorError(null)
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
      // A toast is for something the user started that has already happened, and this
      // one lands on a route change where it is the only trace of the event.
      addToast({ type: "success", title: "Welcome back!" })
      router.push("/dashboard")
    } catch (err: unknown) {
      if (isTwoFactorChallenge(err)) {
        const msg = requiresTwoFactor
          ? "That code did not match. Check your authenticator app and try again."
          : "Enter your two-factor code to continue."
        setRequiresTwoFactor(true)
        // The 2FA field gets its own error rather than only the banner, so the message
        // sits against the control it is about.
        setTwoFactorError(requiresTwoFactor ? msg : null)
        setError(requiresTwoFactor ? null : msg)
      } else {
        setRequiresTwoFactor(false)
        // One refusal, one message, one place: beside the form, announced by role="alert".
        // This used to fire a toast carrying the same sentence, so a sighted reader saw
        // it twice while a screen-reader user heard it once and had nothing to return to.
        setError(getLoginErrorMessage(err))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!hasHydrated || !hasRestoredSession) {
    return <div className="min-h-screen bg-transparent" />
  }

  return (
    <div className="flex min-h-screen bg-transparent">
      <AuthPanel>
        <p className="text-display-sm font-bold leading-tight text-paper">
          Welcome back.
        </p>
      </AuthPanel>

      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-6 lg:px-8 lg:py-12">
        <div className="w-full max-w-sm space-y-7">
          <div>
            <AuthBrand tagline="Real coordination for real life." />
            <h1 className="text-title font-bold tracking-tight text-ink">Sign in</h1>
            <p className="mt-1.5 text-body-sm text-ink-subtle">Enter your credentials to continue</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Field label="Email" error={errors.email?.message}>
              {(field) => (
                <Input
                  {...register("email")}
                  {...field}
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              )}
            </Field>

            <Field label="Password" error={errors.password?.message}>
              {(field) => (
                <PasswordInput
                  {...register("password")}
                  {...field}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              )}
            </Field>

            {requiresTwoFactor && (
              <Field
                label="2FA Code"
                hint="Six digits from your authenticator app."
                error={twoFactorError ?? undefined}
              >
                {(field) => (
                  <Input
                    {...field}
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                  />
                )}
              </Field>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* The box stays 16px because that is what a checkbox looks like, and
                  `.touch-target` paints the 44×44 hit area around it without changing
                  layout — the documented use for a control that must stay visually
                  small. Its two known defeats do not apply here: nothing above it sets
                  `overflow: hidden`, and its nearest neighbour is at the other end of a
                  `justify-between` row rather than within 8px. */}
              <label className="inline-flex min-h-control cursor-pointer items-center gap-2 text-body-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="touch-target h-4 w-4 rounded-sm border-line-strong"
                />
                Remember me
              </label>
              <Link
                href="/auth/forgot-password"
                className="inline-flex min-h-control items-center rounded-md text-body-sm font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
              >
                Forgot password?
              </Link>
            </div>

            <AuthBanner message={error} />

            <Button type="submit" size="lg" loading={submitting} className="w-full">
              Sign in
            </Button>
          </form>

          <p className="text-center text-body-sm text-ink-subtle">
            Don&apos;t have an account?{" "}
            <Link href="/auth/register" className="font-semibold text-ink hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
