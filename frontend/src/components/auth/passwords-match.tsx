"use client"

import { Check } from "lucide-react"

/**
 * "Passwords match", under the confirm field, the moment it agrees with the first.
 *
 * The confirm field used to be silent until submit, and then said only that the two
 * differed — after the person had already moved their hand to the button. Confirming
 * the match while they type turns the second field from a trap into a check they can
 * see pass. Nothing is shown while the fields differ: a live "don't match" would be
 * wrong after every keystroke until the last one.
 *
 * `positive` is spent on a confirmed state, which is what this is.
 */
export function PasswordsMatch({ password, confirm }: { password: string; confirm: string }) {
  const matches = confirm.length > 0 && confirm === password
  return (
    <p role="status">
      {matches ? (
        <span className="mt-2 flex animate-fade-in items-center gap-1.5 text-caption font-semibold text-positive">
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
          Passwords match
        </span>
      ) : null}
    </p>
  )
}
