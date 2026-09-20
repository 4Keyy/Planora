"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { api, parseApiResponse } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { getRegisterErrorMessage } from "@/lib/errors"
import type { AuthRegisterResponse } from "@/types/auth"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PasswordInput } from "@/components/auth/password-input"
import { AuthBanner, AuthBrand, AuthPanel } from "@/components/auth/auth-chrome"
import { PASSWORD_SCHEMA, passwordStrength } from "@/lib/password-policy"
import { DURATION_FAST, EASE_OUT_EXPO } from "@/lib/animations"

const schema = z
  .object({
    firstName: z.string().min(2, "At least 2 characters"),
    lastName: z.string().min(2, "At least 2 characters"),
    email: z.string().email("Invalid email"),
    password: PASSWORD_SCHEMA,
    confirmPassword: z.string().min(1, "Repeat your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
type FormData = z.infer<typeof schema>

export default function RegisterPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const addToast = useToastStore((s) => s.addToast)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const hasRestoredSession = useAuthStore((s) => s.hasRestoredSession)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reduce = useReducedMotion() ?? false

  // Sign-in has had both of these since it was written; this screen had neither, so a
  // signed-in visitor could sit on "Create account" indefinitely and the form rendered
  // before the session restore had even been attempted.
  useEffect(() => {
    if (hasHydrated && hasRestoredSession && isAuthenticated) {
      router.replace("/dashboard")
    }
  }, [hasHydrated, hasRestoredSession, isAuthenticated, router])

  const {
    register,
    handleSubmit,
    watch,
    setError: setFieldError,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const password = watch("password") ?? ""
  const strength = useMemo(() => passwordStrength(password), [password])

  const onSubmit = async (data: FormData) => {
    setSubmitting(true)
    setError(null)
    try {
      // `confirmPassword` is a client-side agreement between two fields. It was being
      // posted with the rest of the form, sending the password to the server twice.
      const res = await api.post<AuthRegisterResponse>("/auth/api/v1/auth/register", {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
      })
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
      addToast({
        type: "success",
        title: "Account created",
        description: "Start by adding your first task.",
      })
      router.push("/dashboard")
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err !== null && "response" in err
          ? ((err as { response?: { status?: number } }).response?.status ?? null)
          : null
      const msg = getRegisterErrorMessage(err)
      if (status === 409) {
        // The offending field is the email, so the message belongs on it: `Field` marks
        // it aria-invalid and announces through role="alert". A banner alone leaves the
        // user hunting for which of five fields the server meant.
        setFieldError("email", { message: msg })
      } else {
        setError(msg)
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
          Decide who sees what.
        </p>
      </AuthPanel>

      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-6 lg:px-8 lg:py-12">
        <div className="w-full max-w-sm space-y-7">
          <div>
            <AuthBrand tagline="Real coordination for real life." />
            <h1 className="text-title font-bold tracking-tight text-ink">Create account</h1>
            <p className="mt-1.5 text-body-sm text-ink-subtle">
              Free, forever. No credit card required.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" error={errors.firstName?.message}>
                {(field) => (
                  <Input {...register("firstName")} {...field} placeholder="Jane" autoComplete="given-name" />
                )}
              </Field>
              <Field label="Last name" error={errors.lastName?.message}>
                {(field) => (
                  <Input {...register("lastName")} {...field} placeholder="Doe" autoComplete="family-name" />
                )}
              </Field>
            </div>

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
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                />
              )}
            </Field>

            {/* The strength meter.
                It animates `transform: scaleX`, not `width`. Width is a layout property,
                so the old version ran layout on every keystroke — and it did so over
                `deliberate` 480ms, a duration the scale reserves for a number roller and
                a progress ring, four times the 320ms ceiling for a response to input.
                The track is always full width, so nothing here can shift. */}
            <div aria-hidden="true">
              <div className="h-1 w-full overflow-hidden rounded-full bg-line">
                <motion.div
                  className="h-full w-full origin-left rounded-full bg-ink"
                  animate={{ scaleX: strength.pct / 100 }}
                  initial={false}
                  transition={reduce ? { duration: 0 } : { duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
                />
              </div>
              <p className="mt-1.5 text-caption font-semibold text-ink-subtle">
                {password.length > 0 ? strength.label : " "}
              </p>
            </div>

            <Field label="Confirm password" error={errors.confirmPassword?.message}>
              {(field) => (
                <PasswordInput
                  {...register("confirmPassword")}
                  {...field}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              )}
            </Field>

            <AuthBanner message={error} />

            <Button type="submit" size="lg" loading={submitting} className="w-full">
              Create account
            </Button>
          </form>

          <p className="text-center text-body-sm text-ink-subtle">
            Already have an account?{" "}
            <Link href="/auth/login" className="font-semibold text-ink hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
