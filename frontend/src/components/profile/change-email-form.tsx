"use client"

import { useState, type FormEvent } from "react"
import { Check, MailWarning } from "lucide-react"
import { api } from "@/lib/api"
import { getAccountChangeErrorKind, getAuthRequestMessage } from "@/lib/errors"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PasswordInput } from "@/components/auth/password-input"
import { EmailSuggestion } from "@/components/auth/email-suggestion"
import { AuthBanner } from "@/components/auth/auth-chrome"
import { cn } from "@/lib/utils"

/**
 * Changing or re-verifying the email from the profile.
 *
 * The same honesty pass as the password form: labelled fields instead of placeholders that
 * disappear on the first keystroke, the button blocked while the request is in flight, the
 * domain-typo fix the sign-up form already offers, and each refusal on its field — "that
 * address is taken" on the address, "wrong password" on the password — instead of one
 * vanishing "Failed to change email" toast.
 */
type FieldErrors = Partial<Record<"newEmail" | "password", string>>

export function ChangeEmailForm({
  currentEmail,
  verified,
  onChanged,
  onResend,
  resending,
}: {
  currentEmail: string | null | undefined
  verified: boolean
  onChanged: (email: string) => void
  onResend: () => void
  resending: boolean
}) {
  const [newEmail, setNewEmail] = useState("")
  const [blurredEmail, setBlurredEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBanner(null)
    const email = newEmail.trim()
    const found: FieldErrors = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) found.newEmail = "Enter a valid email address"
    else if (email.toLowerCase() === (currentEmail ?? "").toLowerCase()) found.newEmail = "That is already your email"
    if (!password) found.password = "Enter your password to confirm"
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaving(true)
    try {
      await api.post("/auth/api/v1/users/me/change-email", { newEmail: email, password })
      setNewEmail("")
      setBlurredEmail("")
      setPassword("")
      onChanged(email)
    } catch (err: unknown) {
      const kind = getAccountChangeErrorKind(err)
      if (kind === "wrong-password") setErrors({ password: "That password isn't right." })
      else if (kind === "email-taken") setErrors({ newEmail: "Another account already uses this address." })
      else if (kind === "invalid-email") setErrors({ newEmail: "Enter a valid email address" })
      else setBanner(getAuthRequestMessage(kind === "rate-limited" || kind === "network" ? kind : "unknown"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col">
      <div className="space-y-5">
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg border px-4 py-3",
            verified ? "border-line bg-paper-sunken" : "border-warn/30 bg-warn-surface",
          )}
        >
          {verified ? (
            <Check className="h-4 w-4 flex-shrink-0 text-ink" aria-hidden="true" />
          ) : (
            <MailWarning className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-sm font-semibold text-ink">{currentEmail || "—"}</span>
            <span className={cn("block text-caption font-semibold", verified ? "text-ink-muted" : "text-warn")}>
              {verified ? "Verified" : "Not verified yet"}
            </span>
          </span>
          {verified ? null : (
            <Button type="button" variant="outline" size="sm" onClick={onResend} loading={resending} className="flex-shrink-0">
              Send link again
            </Button>
          )}
        </div>

        <Field label="New email" error={errors.newEmail}>
          {(field) => (
            <div>
              <Input
                {...field}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onBlur={(e) => setBlurredEmail(e.target.value)}
              />
              <EmailSuggestion
                email={blurredEmail}
                onAccept={(s) => {
                  setNewEmail(s)
                  setBlurredEmail(s)
                }}
              />
            </div>
          )}
        </Field>
        <Field label="Password" hint="To confirm it's you." error={errors.password}>
          {(field) => (
            <PasswordInput
              {...field}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              capsLockHint
              autoComplete="current-password"
            />
          )}
        </Field>
        <AuthBanner message={banner} />
      </div>
      <div className="mt-auto pt-6">
        <Button type="submit" loading={saving} className="w-full">
          Change email
        </Button>
      </div>
    </form>
  )
}
