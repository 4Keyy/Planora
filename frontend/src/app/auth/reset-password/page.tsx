"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { LockKeyhole, Unlink } from "lucide-react"
import { api } from "@/lib/api"
import { getAuthRequestMessage, getResetErrorKind } from "@/lib/errors"
import { RESET_EMAIL_KEY, RESET_SENT_AT_KEY } from "@/lib/auth-flow"
import { EASY_TO_GUESS_MESSAGE, NEW_PASSWORD_SCHEMA } from "@/lib/password-policy"
import { Field } from "@/components/ui/field"
import { Button, buttonVariants } from "@/components/ui/button"
import { PasswordInput } from "@/components/auth/password-input"
import { PasswordChecklist } from "@/components/auth/password-checklist"
import { PasswordsMatch } from "@/components/auth/passwords-match"
import { AUTH_LINK_CLASS, AuthBanner, AuthCard, AuthMark } from "@/components/auth/auth-chrome"
import { useRecoveryDone } from "@/components/auth/auth-frame"
import { cn } from "@/lib/utils"

/**
 * Steps 3 and 4 of 4: the new password, then "Password changed".
 *
 * The token is no longer a field. The old page asked people to "paste the token from
 * your email" — nobody has a raw token, they have a link, and the link already put the
 * token in this page's address. It is read from there and never shown.
 *
 * The new password is checked against the real rule as it is typed (the old page did not
 * check it at all), and the server's two password refusals land ON the password field:
 * the old page answered "too weak" and "found in a breach" with "Check the token and try
 * again", sending people to inspect a link that was fine.
 *
 * A dead link is a whole card, not a banner. The server does not say whether a link
 * expired or was used (both are `INVALID_TOKEN`), and nothing on the form can fix either
 * — so the form goes away and the one thing that helps, a new link, takes its place.
 *
 * No toasts: every outcome is the card in front of you.
 */
const schema = z
  .object({
    // The server checks a CHANGED password for more than the five rules (common
    // passwords, runs like "1234", repeats like "aaaa"); the schema does too, so a ticked
    // checklist is not followed by an unexplained refusal.
    newPassword: NEW_PASSWORD_SCHEMA,
    confirmPassword: z.string().min(1, "Repeat your new password"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "The two passwords don't match.",
    path: ["confirmPassword"],
  })
type FormData = z.infer<typeof schema>

const CHECKLIST_ID = "reset-password-rules"

function NewLinkAction() {
  return (
    <Link href="/auth/forgot-password" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
      Send a new link
    </Link>
  )
}

function ResetPasswordContent() {
  const params = useSearchParams()
  const token = params.get("token") || params.get("resetToken") || ""
  const markDone = useRecoveryDone()
  const [state, setState] = useState<"form" | "dead-link" | "done">("form")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setError: setFieldError,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const newPassword = watch("newPassword") ?? ""
  const confirmPassword = watch("confirmPassword") ?? ""

  useEffect(() => {
    markDone(state === "done")
  }, [state, markDone])

  const onSubmit = async (data: FormData) => {
    setSubmitting(true)
    setError(null)
    try {
      await api.post("/auth/api/v1/auth/reset-password", {
        resetToken: token,
        newPassword: data.newPassword,
        confirmPassword: data.confirmPassword,
      })
      try {
        sessionStorage.removeItem(RESET_EMAIL_KEY)
        sessionStorage.removeItem(RESET_SENT_AT_KEY)
      } catch {
        // Nothing to clean up when storage is blocked.
      }
      setState("done")
    } catch (err: unknown) {
      const kind = getResetErrorKind(err)
      if (kind === "invalid-token") setState("dead-link")
      else if (kind === "weak-password")
        setFieldError("newPassword", { message: EASY_TO_GUESS_MESSAGE })
      else if (kind === "compromised-password")
        setFieldError("newPassword", { message: "This password has appeared in a data breach. Choose a different one." })
      else setError(getAuthRequestMessage(kind))
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <AuthCard
        key="no-token"
        mark={<AuthMark icon={Unlink} />}
        title="Open the link from your email"
        lead="This page needs the link from your reset email. If it's gone or has expired, ask for a new one."
      >
        <NewLinkAction />
      </AuthCard>
    )
  }

  if (state === "dead-link") {
    return (
      <AuthCard
        key="dead-link"
        mark={<AuthMark icon={Unlink} />}
        title="This link has expired or was already used"
        lead="Reset links work once and don't last long. Ask for a new one and use it right away."
      >
        <NewLinkAction />
      </AuthCard>
    )
  }

  if (state === "done") {
    return (
      <AuthCard
        key="done"
        mark={<AuthMark icon="check" />}
        title="Password changed"
        lead="You can sign in with your new password now. We've also emailed you a note that it changed."
      >
        <Link href="/auth/login" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
          Sign in
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      key="form"
      mark={<AuthMark icon={LockKeyhole} />}
      title="Choose a new password"
      lead="Pick something new. You'll use it to sign in from now on."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/auth/login" className={AUTH_LINK_CLASS}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <Field label="New password" error={errors.newPassword?.message}>
          {(field) => (
            <div className="space-y-3">
              <PasswordInput
                {...register("newPassword")}
                {...field}
                aria-describedby={[field["aria-describedby"], CHECKLIST_ID].filter(Boolean).join(" ")}
                capsLockHint
                autoComplete="new-password"
              />
              <PasswordChecklist id={CHECKLIST_ID} value={newPassword} />
            </div>
          )}
        </Field>

        <Field label="Confirm new password" error={errors.confirmPassword?.message}>
          {(field) => (
            <div>
              <PasswordInput {...register("confirmPassword")} {...field} capsLockHint autoComplete="new-password" />
              <PasswordsMatch password={newPassword} confirm={confirmPassword} />
            </div>
          )}
        </Field>

        <AuthBanner message={error} />

        <Button type="submit" size="lg" loading={submitting} className="w-full">
          Save new password
        </Button>
      </form>
    </AuthCard>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-busy="true" />}>
      <ResetPasswordContent />
    </Suspense>
  )
}
