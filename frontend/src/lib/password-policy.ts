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

/**
 * Strength, as six independent facts rather than a score with opinions in it.
 * Returned as a count so the meter can render a length and the label can name a band.
 */
export function passwordStrength(value: string): { score: number; label: string; pct: number } {
  const checks = [
    value.length >= PASSWORD_MIN,
    value.length >= 12,
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ]
  const score = checks.filter(Boolean).length
  const pct = (score / checks.length) * 100

  // Four bands, and each one is reachable — the previous version gave `Fair` and `Good`
  // the same colour and never awarded `Strong` below a perfect six, so two of the four
  // names told the user nothing.
  const label = score <= 2 ? "Weak" : score <= 4 ? "Fair" : score === 5 ? "Good" : "Strong"
  return { score, label, pct }
}
