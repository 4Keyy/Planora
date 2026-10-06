"use client"

import { suggestEmailDomain } from "@/lib/auth-flow"

/**
 * "Did you mean alex@gmail.com?" under an email field.
 *
 * A mistyped domain is the one sign-up mistake that fails silently: the account is
 * created, the verification and reset emails go to an address nobody reads, and the
 * person finds out weeks later. The fix is one tap, and the suggestion comes only from a
 * list of exact known typos (`suggestEmailDomain`), never from a guess.
 *
 * Callers pass the value as it was when the field lost focus, not on every keystroke —
 * "alex@gmai" is a typo only once the person has stopped typing.
 *
 * The button is inline text in a sentence, so it stays text-height and `.touch-target`
 * paints its 44px hit area; nothing else on the line is pressable.
 */
export function EmailSuggestion({ email, onAccept }: { email: string; onAccept: (suggestion: string) => void }) {
  const suggestion = suggestEmailDomain(email)
  if (!suggestion) return null

  return (
    <p className="mt-2 animate-slide-up text-body-sm text-ink-muted">
      Did you mean{" "}
      <button
        type="button"
        onClick={() => onAccept(suggestion)}
        className="touch-target break-all rounded-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 transition-colors duration-fast hover:decoration-ink"
      >
        {suggestion}
      </button>
      ?
    </p>
  )
}
