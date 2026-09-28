"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { Mail } from "lucide-react"
import { api } from "@/lib/api"
import { getLinkRequestMessage } from "@/lib/errors"
import { RESET_EMAIL_KEY, RESET_SENT_AT_KEY } from "@/lib/auth-flow"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { EmailSuggestion } from "@/components/auth/email-suggestion"
import { AUTH_LINK_CLASS, AuthBanner, AuthCard, AuthMark } from "@/components/auth/auth-chrome"

/**
 * Step 1 of 4 of resetting a password: the address.
 *
 * Recovery is one path with a visible step scale (it lives in the auth frame), because
 * it used to be four unconnected dead ends: this form ended on a toast and left you on
 * the same form, and nothing told you what came next. Now a sent request moves you to
 * step 2, "Check your inbox", which says where the link went and how to get another.
 *
 * The address travels to step 2 in sessionStorage — this tab only, gone when it closes —
 * so that screen can name it (masked) and offer "Send it again" without asking twice.
 * "Use a different email" comes back here with the field already filled.
 *
 * No toast: the next screen IS the confirmation.
 */
const schema = z.object({ email: z.string().trim().email("Enter a valid email address") })
type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blurredEmail, setBlurredEmail] = useState("")

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  // Prefill after mount, not during render: sessionStorage does not exist on the server,
  // and reading it while rendering would make the two HTMLs disagree.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(RESET_EMAIL_KEY)
      if (saved) setValue("email", saved)
    } catch {
      // Storage blocked: the field simply starts empty.
    }
  }, [setValue])

  const onSubmit = async ({ email }: FormData) => {
    setSubmitting(true)
    setError(null)
    try {
      await api.post("/auth/api/v1/auth/request-password-reset", { email })
      try {
        sessionStorage.setItem(RESET_EMAIL_KEY, email)
        sessionStorage.setItem(RESET_SENT_AT_KEY, String(Date.now()))
      } catch {
        // Storage blocked: step 2 falls back to wording that does not need the address.
      }
      router.push("/auth/forgot-password/sent")
    } catch (err: unknown) {
      setError(getLinkRequestMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <AuthCard
      mark={<AuthMark icon={Mail} />}
      title="Reset your password"
      lead="Enter the email you signed up with and we'll send you a link to choose a new one."
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

        <AuthBanner message={error} />

        <Button type="submit" size="lg" loading={submitting} className="w-full">
          Send the link
        </Button>
      </form>
    </AuthCard>
  )
}
