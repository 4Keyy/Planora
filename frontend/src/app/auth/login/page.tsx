"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { KeyRound, Smartphone } from "lucide-react"
import { api, parseApiResponse } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { getLoginErrorMessage, isTwoFactorChallenge } from "@/lib/errors"
import type { AuthLoginResponse } from "@/types/auth"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PasswordInput } from "@/components/auth/password-input"
import { AUTH_LINK_CLASS, AuthBanner, AuthCard, AuthMark } from "@/components/auth/auth-chrome"
import { EmailSuggestion } from "@/components/auth/email-suggestion"
import { CODE_LENGTH, OneTimeCodeInput } from "@/components/auth/one-time-code-input"
import { DURATION_FAST, DURATION_UI, EASE_EXIT, EASE_OUT_EXPO } from "@/lib/animations"

/**
 * Sign in.
 *
 * One card in the shared auth frame, where there used to be a split screen with a dark
 * panel holding a single sentence. Two stages share the card:
 *
 *   1. Email and password, with the two mistakes a form can catch before the server
 *      does: a known email-domain typo ("Did you mean …@gmail.com?", on blur) and Caps
 *      Lock being on over a masked password.
 *   2. When the server asks for a second factor, the password field gives way to six
 *      code cells that submit on the sixth digit. The same field on the server also takes
 *      a single-use recovery code, so "Use a recovery code instead" swaps the cells for a
 *      plain text field. The email and password stay in the form, hidden, for the retry.
 *
 * The card renders at once, in the server HTML. It used to wait for the session restore
 * — a network round trip — behind a blank screen, so every visit to sign-in started with
 * nothing on it. A visitor who turns out to be signed in is still sent to the dashboard;
 * they see the form for the length of that round trip instead of everyone seeing nothing.
 *
 * The password is checked for presence here, not against the create-account rule. A
 * person signing in is recalling a password, not choosing one: "Needs a special
 * character" under a mistyped password names a rule they cannot act on, and a wrong
 * password of any shape gets the server's one answer — "That email and password don't
 * match."
 */
const schema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
})
type FormData = z.infer<typeof schema>

type CodeMode = "app" | "recovery"

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const addToast = useToastStore((s) => s.addToast)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const hasRestoredSession = useAuthStore((s) => s.hasRestoredSession)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const reduce = useReducedMotion() ?? false

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rememberMe, setRememberMe] = useState(false)
  const [blurredEmail, setBlurredEmail] = useState("")
  const [stage, setStage] = useState<"credentials" | "code">("credentials")
  const [codeMode, setCodeMode] = useState<CodeMode>("app")
  const [code, setCode] = useState("")
  const [codeError, setCodeError] = useState<string | null>(null)
  const returnedToCredentials = useRef(false)

  useEffect(() => {
    if (hasHydrated && hasRestoredSession && isAuthenticated) {
      router.replace("/dashboard")
    }
  }, [hasHydrated, hasRestoredSession, isAuthenticated, router])

  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  // "Back" returns focus to the email field — after the credentials stage has mounted.
  useEffect(() => {
    if (stage === "credentials" && returnedToCredentials.current) {
      returnedToCredentials.current = false
      setFocus("email")
    }
  }, [stage, setFocus])

  const signIn = async (data: FormData, codeOverride?: string) => {
    const secondFactor = stage === "code" ? (codeOverride ?? code).trim() : undefined
    if (stage === "code") {
      if (codeMode === "app" && (secondFactor ?? "").length < CODE_LENGTH) {
        setCodeError("Enter all 6 digits.")
        return
      }
      if (codeMode === "recovery" && !secondFactor) {
        setCodeError("Enter one of your recovery codes.")
        return
      }
    }

    setSubmitting(true)
    setError(null)
    setCodeError(null)
    try {
      const res = await api.post<AuthLoginResponse>("/auth/api/v1/auth/login", {
        email: data.email,
        password: data.password,
        rememberMe,
        twoFactorCode: secondFactor,
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
        if (stage === "credentials") {
          setStage("code")
        } else {
          // The message sits against the cells it is about, and the cells empty so the
          // next code can be typed straight in.
          setCodeError(
            codeMode === "app"
              ? "That code didn't match. Check your app and try again."
              : "That recovery code didn't work. Each one works only once.",
          )
          if (codeMode === "app") setCode("")
        }
      } else {
        // One refusal, one message, one place: beside the form, announced by role="alert".
        setError(getLoginErrorMessage(err))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const submit = (codeOverride?: string) => handleSubmit((data) => signIn(data, codeOverride))()

  const switchCodeMode = () => {
    setCodeMode((m) => (m === "app" ? "recovery" : "app"))
    setCode("")
    setCodeError(null)
  }

  const back = () => {
    returnedToCredentials.current = true
    setStage("credentials")
    setCodeMode("app")
    setCode("")
    setCodeError(null)
    setError(null)
  }

  const stageMotion = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } },
    exit: reduce
      ? { opacity: 0, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }
      : { opacity: 0, y: -8, transition: { duration: DURATION_FAST, ease: EASE_EXIT } },
  }

  const codeHintId = "login-code-hint"

  return (
    <AuthCard
      mark={<AuthMark key={stage} icon={stage === "code" ? Smartphone : KeyRound} />}
      title={stage === "code" ? "Two-step sign-in" : "Welcome back"}
      lead={
        stage === "code"
          ? codeMode === "app"
            ? "Enter the 6-digit code from your authenticator app."
            : "Enter one of the recovery codes you saved when you turned on two-step sign-in."
          : "Sign in to your tasks and the people you share them with."
      }
      footer={
        <>
          New to Planora?{" "}
          <Link href="/auth/register" className={AUTH_LINK_CLASS}>
            Create an account
          </Link>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="relative"
        noValidate
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {stage === "credentials" ? (
            <motion.div key="credentials" {...stageMotion} className="space-y-5">
              <Field label="Email" error={errors.email?.message}>
                {(field) => {
                  const reg = register("email", { onBlur: (e) => setBlurredEmail(e.target.value) })
                  return (
                    <div>
                      <Input
                        {...reg}
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
                  )
                }}
              </Field>

              <Field
                label="Password"
                error={errors.password?.message}
                labelAside={
                  <Link
                    href="/auth/forgot-password"
                    className="touch-target rounded-sm text-caption font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
                  >
                    Forgot password?
                  </Link>
                }
              >
                {(field) => (
                  <PasswordInput {...register("password")} {...field} capsLockHint autoComplete="current-password" />
                )}
              </Field>

              {/* The box stays 16px because that is what a checkbox looks like, and
                  `.touch-target` paints the 44×44 hit area around it without changing
                  layout — the documented use for a control that must stay visually
                  small. Nothing above it sets `overflow: hidden`, and the label around it
                  makes the whole line a target anyway. */}
              <label className="flex min-h-control cursor-pointer items-center gap-3 text-body-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="touch-target h-4 w-4 flex-shrink-0 cursor-pointer rounded-sm accent-ink"
                />
                Keep me signed in for 30 days
              </label>
            </motion.div>
          ) : (
            <motion.div key="code" {...stageMotion} className="space-y-5">
              {codeMode === "app" ? (
                <div className="space-y-2">
                  <OneTimeCodeInput
                    value={code}
                    onChange={(next) => {
                      setCode(next)
                      if (codeError) setCodeError(null)
                    }}
                    onComplete={(full) => void submit(full)}
                    invalid={Boolean(codeError)}
                    aria-describedby={codeError ? codeHintId : undefined}
                    autoFocus
                  />
                  {codeError ? (
                    <p id={codeHintId} role="alert" className="text-caption font-medium text-alert">
                      {codeError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <Field label="Recovery code" error={codeError}>
                  {(field) => (
                    <Input
                      {...field}
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value)
                        if (codeError) setCodeError(null)
                      }}
                      autoComplete="one-time-code"
                      autoCapitalize="characters"
                      spellCheck={false}
                      autoFocus
                    />
                  )}
                </Field>
              )}

              <div className="flex flex-wrap items-center justify-between gap-x-4">
                <button
                  type="button"
                  onClick={back}
                  className="inline-flex min-h-control items-center rounded-md text-body-sm font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={switchCodeMode}
                  className="inline-flex min-h-control items-center rounded-md text-body-sm font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
                >
                  {codeMode === "app" ? "Use a recovery code instead" : "Use the 6-digit code"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-6 space-y-4">
          <AuthBanner message={error} />
          <Button type="submit" size="lg" loading={submitting} className="w-full">
            {stage === "code" ? "Verify and sign in" : "Sign in"}
          </Button>
        </div>
      </form>
    </AuthCard>
  )
}
