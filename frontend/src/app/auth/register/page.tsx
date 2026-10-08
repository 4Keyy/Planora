"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { UserPlus } from "lucide-react"
import { api, parseApiResponse } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { getRegisterErrorMessage } from "@/lib/errors"
import type { AuthRegisterResponse } from "@/types/auth"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PasswordInput } from "@/components/auth/password-input"
import { PasswordChecklist } from "@/components/auth/password-checklist"
import { PasswordsMatch } from "@/components/auth/passwords-match"
import { EmailSuggestion } from "@/components/auth/email-suggestion"
import { AUTH_LINK_CLASS, AuthBanner, AuthCard, AuthMark } from "@/components/auth/auth-chrome"
import { PASSWORD_SCHEMA } from "@/lib/password-policy"

/**
 * Create an account.
 *
 * One card in the shared auth frame. The strength bar is gone: it scored the password
 * into four words the server does not accept, so it could read "Good" over a password
 * about to be refused. In its place the checklist names the five rules the server
 * checks and ticks each one as it is met, and a "Passwords match" line confirms the
 * second field the moment it agrees with the first — the two places people get stuck,
 * answered while they are typing rather than after they press the button.
 *
 * The card renders at once, in the server HTML, for the reason the sign-in page gives.
 */
const schema = z
  .object({
    firstName: z.string().trim().min(2, "At least 2 characters"),
    lastName: z.string().trim().min(2, "At least 2 characters"),
    email: z.string().trim().email("Enter a valid email address"),
    password: PASSWORD_SCHEMA,
    confirmPassword: z.string().min(1, "Repeat your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "The two passwords don't match.",
    path: ["confirmPassword"],
  })
type FormData = z.infer<typeof schema>

const CHECKLIST_ID = "register-password-rules"

export default function RegisterPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const addToast = useToastStore((s) => s.addToast)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const hasRestoredSession = useAuthStore((s) => s.hasRestoredSession)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blurredEmail, setBlurredEmail] = useState("")

  useEffect(() => {
    if (hasHydrated && hasRestoredSession && isAuthenticated) {
      router.replace("/dashboard")
    }
  }, [hasHydrated, hasRestoredSession, isAuthenticated, router])

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError: setFieldError,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const password = watch("password") ?? ""
  const confirmPassword = watch("confirmPassword") ?? ""

  const onSubmit = async (data: FormData) => {
    setSubmitting(true)
    setError(null)
    try {
      // The current API contract also validates the confirmation; keep both sides aligned.
      const res = await api.post<AuthRegisterResponse>("/auth/api/v1/auth/register", {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
        confirmPassword: data.confirmPassword,
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

  return (
    <AuthCard
      mark={<AuthMark icon={UserPlus} />}
      title="Create your account"
      lead="Free, and no card needed. Your tasks stay private until you share them."
      footer={
        <>
          Have an account?{" "}
          <Link href="/auth/login" className={AUTH_LINK_CLASS}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={errors.firstName?.message}>
            {(field) => <Input {...register("firstName")} {...field} autoComplete="given-name" />}
          </Field>
          <Field label="Last name" error={errors.lastName?.message}>
            {(field) => <Input {...register("lastName")} {...field} autoComplete="family-name" />}
          </Field>
        </div>

        <Field label="Email" error={errors.email?.message}>
          {(field) => (
            <div>
              <Input
                {...register("email", { onBlur: (e) => setBlurredEmail(e.target.value) })}
                {...field}
                type="email"
                inputMode="email"
                placeholder="you@example.com"
                autoComplete="email"
              />
              <EmailSuggestion
                email={blurredEmail}
                onAccept={(s) => {
                  setValue("email", s, { shouldValidate: true })
                  setBlurredEmail(s)
                }}
              />
            </div>
          )}
        </Field>

        <Field label="Password" error={errors.password?.message}>
          {(field) => (
            <div className="space-y-3">
              <PasswordInput
                {...register("password")}
                {...field}
                aria-describedby={[field["aria-describedby"], CHECKLIST_ID].filter(Boolean).join(" ")}
                capsLockHint
                autoComplete="new-password"
              />
              <PasswordChecklist id={CHECKLIST_ID} value={password} />
            </div>
          )}
        </Field>

        <Field label="Confirm password" error={errors.confirmPassword?.message}>
          {(field) => (
            <div>
              <PasswordInput {...register("confirmPassword")} {...field} capsLockHint autoComplete="new-password" />
              <PasswordsMatch password={password} confirm={confirmPassword} />
            </div>
          )}
        </Field>

        <AuthBanner message={error} />

        <Button type="submit" size="lg" loading={submitting} className="w-full">
          Create account
        </Button>
      </form>
    </AuthCard>
  )
}
