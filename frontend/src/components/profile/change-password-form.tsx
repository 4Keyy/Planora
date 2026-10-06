"use client"

import { useState, type FormEvent } from "react"
import { api } from "@/lib/api"
import { getAccountChangeErrorKind, getAuthRequestMessage } from "@/lib/errors"
import { NEW_PASSWORD_SCHEMA } from "@/lib/password-policy"
import { Field } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { PasswordInput } from "@/components/auth/password-input"
import { PasswordChecklist } from "@/components/auth/password-checklist"
import { PasswordsMatch } from "@/components/auth/passwords-match"
import { AuthBanner } from "@/components/auth/auth-chrome"

/**
 * Changing the password from the profile.
 *
 * It was three placeholder-only inputs — no labels once you started typing, no check of
 * the new password before the round trip, the button free to be pressed twice, and every
 * refusal ("current password is wrong", "too weak", "found in a breach", "used before")
 * collapsed into one toast, "Failed to change password", that vanished before it could
 * be read. Now each field is labelled, the new password shows the same checklist as
 * create-account and reset, the second field confirms the match as it is typed, and each
 * refusal lands on the field it is about. The server runs the same extra checks here as on
 * reset, so the form checks with `NEW_PASSWORD_SCHEMA` too.
 */
type FieldErrors = Partial<Record<"currentPassword" | "newPassword" | "confirmNewPassword", string>>

const CHECKLIST_ID = "profile-password-rules"

export function ChangePasswordForm({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmNewPassword, setConfirmNewPassword] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const validate = (): FieldErrors => {
    const next: FieldErrors = {}
    if (!currentPassword) next.currentPassword = "Enter your current password"
    const parsed = NEW_PASSWORD_SCHEMA.safeParse(newPassword)
    if (!parsed.success) next.newPassword = parsed.error.issues[0]?.message ?? "Choose a stronger password"
    else if (newPassword === currentPassword) next.newPassword = "Choose a password you are not using now"
    if (!confirmNewPassword) next.confirmNewPassword = "Repeat the new password"
    else if (confirmNewPassword !== newPassword) next.confirmNewPassword = "The two passwords don't match."
    return next
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBanner(null)
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaving(true)
    try {
      await api.post("/auth/api/v1/users/me/change-password", { currentPassword, newPassword, confirmNewPassword })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmNewPassword("")
      onChanged()
    } catch (err: unknown) {
      const kind = getAccountChangeErrorKind(err)
      if (kind === "wrong-password") setErrors({ currentPassword: "That isn't your current password." })
      else if (kind === "weak-password")
        setErrors({ newPassword: "Too easy to guess. Avoid runs like 1234 or abcd, and repeats like aaaa." })
      else if (kind === "compromised-password")
        setErrors({ newPassword: "This password has appeared in a data breach. Choose a different one." })
      else if (kind === "reused-password") setErrors({ newPassword: "You've used this password before. Choose a new one." })
      else setBanner(getAuthRequestMessage(kind === "rate-limited" || kind === "network" ? kind : "unknown"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col">
      <div className="space-y-5">
        <Field label="Current password" error={errors.currentPassword}>
          {(field) => (
            <PasswordInput
              {...field}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              capsLockHint
              autoComplete="current-password"
            />
          )}
        </Field>
        <Field label="New password" error={errors.newPassword}>
          {(field) => (
            <div className="space-y-3">
              <PasswordInput
                {...field}
                aria-describedby={[field["aria-describedby"], CHECKLIST_ID].filter(Boolean).join(" ")}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                capsLockHint
                autoComplete="new-password"
              />
              <PasswordChecklist id={CHECKLIST_ID} value={newPassword} />
            </div>
          )}
        </Field>
        <Field label="Confirm new password" error={errors.confirmNewPassword}>
          {(field) => (
            <div>
              <PasswordInput
                {...field}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                capsLockHint
                autoComplete="new-password"
              />
              <PasswordsMatch password={newPassword} confirm={confirmNewPassword} />
            </div>
          )}
        </Field>
        <AuthBanner message={banner} />
      </div>
      <div className="mt-auto pt-6">
        <Button type="submit" loading={saving} className="w-full">
          Change password
        </Button>
      </div>
    </form>
  )
}
