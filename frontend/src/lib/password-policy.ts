import { z } from "zod"

/**
 * The password rule, declared once.
 *
 * Sign-in accepted `min(6)` while create-account required 8 plus four character
 * classes, which meant the sign-in form accepted a shape of password that the
 * create-account form could not produce — and `confirmPassword` was a third rule again,
 * `min(6)` with no message at all, so failing it showed an empty error.
 *
 * These mirror the server (`PasswordValidator` in the Auth API: min 8, max 128, upper,
 * lower, digit, special). The client checking a weaker rule than the server does not
 * make anything more permissive; it just moves the refusal from a field label to a
 * round trip.
 */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export const PASSWORD_SCHEMA = z
  .string()
  .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters`)
  .regex(/[A-Z]/, "Needs an uppercase letter")
  .regex(/[a-z]/, "Needs a lowercase letter")
  .regex(/[0-9]/, "Needs a number")
  .regex(/[^A-Za-z0-9]/, "Needs a special character")

export type PasswordRuleId = "length" | "upper" | "lower" | "number" | "symbol"

/**
 * The same rule, as the checklist a person reads while typing.
 *
 * It replaces a strength meter that scored six "facts" into four bands. The score
 * answered a question nobody asked — the server does not accept a "Good" password, it
 * accepts one that meets five rules — so a person could watch the bar reach "Good" and
 * still be refused. The checklist names exactly what the server will check, and a test
 * holds it to `PASSWORD_SCHEMA` so the two can never disagree.
 */
export const PASSWORD_RULES: { id: PasswordRuleId; label: string; test: (value: string) => boolean }[] = [
  {
    id: "length",
    label: `${PASSWORD_MIN} or more characters`,
    test: (v) => v.length >= PASSWORD_MIN && v.length <= PASSWORD_MAX,
  },
  { id: "upper", label: "An uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { id: "lower", label: "A lowercase letter", test: (v) => /[a-z]/.test(v) },
  { id: "number", label: "A number", test: (v) => /[0-9]/.test(v) },
  { id: "symbol", label: "A symbol", test: (v) => /[^A-Za-z0-9]/.test(v) },
]

const COMMON_PASSWORDS = new Set([
  "password", "12345678", "qwerty", "abc12345", "password123",
  "admin", "letmein", "welcome", "monkey", "dragon",
])

/**
 * The checks the server adds when a password is CHANGED — reset and the profile's change
 * form (`PasswordValidator.IsStrongPassword`) — on top of the five rules: a short list of
 * common passwords (compared with and without punctuation), a run of four ascending
 * characters ("1234", "abcd"), or four identical ones ("aaaa").
 *
 * Mirrored here so a password that ticks all five rules is not refused after a round trip
 * with nothing on screen to explain why. Create-account does not run these on the server,
 * so it does not run them here either — the client never refuses what the server accepts.
 */
export function isEasyToGuess(value: string): boolean {
  const letters = value.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()
  if (COMMON_PASSWORDS.has(value.toLowerCase()) || COMMON_PASSWORDS.has(letters)) return true
  for (let i = 0; i + 4 <= value.length; i++) {
    const a = value.charCodeAt(i)
    if (value.charCodeAt(i + 1) === a + 1 && value.charCodeAt(i + 2) === a + 2 && value.charCodeAt(i + 3) === a + 3) return true
    if (value[i] === value[i + 1] && value[i] === value[i + 2] && value[i] === value[i + 3]) return true
  }
  return false
}

export const EASY_TO_GUESS_MESSAGE = "Too easy to guess. Avoid runs like 1234 or abcd, and repeats like aaaa."

/** The rule for a new password on an existing account. */
export const NEW_PASSWORD_SCHEMA = PASSWORD_SCHEMA.refine((v) => !isEasyToGuess(v), EASY_TO_GUESS_MESSAGE)
