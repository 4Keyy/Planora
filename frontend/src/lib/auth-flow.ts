/**
 * The pure parts of the sign-in, recovery and verification screens.
 *
 * Password recovery used to be four unconnected dead ends: a form that ended on a
 * toast, a page that asked for a token nobody has, and no way back from either. It is
 * now one path with a visible step scale, and the scale needs to know which step a
 * route is — that, the address masking on the "check your inbox" screen, the typo fix
 * under an email field and the resend countdown all live here, where they can be
 * tested without rendering a page (`src/app/**` is excluded from coverage).
 */

export type RecoveryStep = 1 | 2 | 3 | 4

export const RECOVERY_STEPS: { step: RecoveryStep; label: string }[] = [
  { step: 1, label: "Email" },
  { step: 2, label: "Inbox" },
  { step: 3, label: "New password" },
  { step: 4, label: "Done" },
]

const RECOVERY_ROUTES: Record<string, RecoveryStep> = {
  "/auth/forgot-password": 1,
  "/auth/forgot-password/sent": 2,
  "/auth/reset-password": 3,
}

/**
 * The step a route stands for, or null when the route is not part of recovery.
 * Step 4 has no route of its own: it is the reset page after the new password saved.
 */
export function recoveryStepFor(pathname: string): RecoveryStep | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  return RECOVERY_ROUTES[path] ?? null
}

/**
 * "alex.morgan@gmail.com" → "a•••n@gmail.com".
 *
 * The "check your inbox" screen names the address so a person can spot a typo, but
 * the screen may be read over a shoulder or captured in a screenshot, and the whole
 * local part is more than it takes to recognise your own address.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@")
  if (at < 1 || at === email.length - 1) return email
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const masked = local.length <= 2 ? `${local[0]}•••` : `${local[0]}•••${local[local.length - 1]}`
  return `${masked}@${domain}`
}

/**
 * The domains people mistype most, mapped to what they meant. Only exact matches are
 * corrected: a guess from edit distance would "fix" real company domains that happen to
 * sit one letter away from a webmail provider.
 */
const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.om": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "outlook.co": "outlook.com",
  "outlook.con": "outlook.com",
  "iclod.com": "icloud.com",
  "icoud.com": "icloud.com",
  "icloud.co": "icloud.com",
  "icloud.con": "icloud.com",
  "yandex.ri": "yandex.ru",
  "yandex.r": "yandex.ru",
  "mail.ri": "mail.ru",
  "mail.r": "mail.ru",
}

/** The corrected full address when the domain is a known typo, otherwise null. */
export function suggestEmailDomain(email: string): string | null {
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf("@")
  if (at < 1 || at === trimmed.length - 1) return null
  const fix = DOMAIN_TYPOS[trimmed.slice(at + 1).toLowerCase()]
  return fix ? `${trimmed.slice(0, at)}@${fix}` : null
}

/**
 * How long "Send it again" waits. The server rate-limits the endpoint per address;
 * a button that is always live invites the second press that trips the limit.
 */
export const RESEND_COOLDOWN_SECONDS = 60

/** 42 → "0:42", 60 → "1:00". Negative and fractional input never renders as such. */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return `${minutes}:${rest.toString().padStart(2, "0")}`
}

/** Whole seconds left of the resend cooldown that started at `sentAt` (epoch ms). */
export function cooldownLeft(sentAt: number | null, now: number): number {
  if (sentAt === null || !Number.isFinite(sentAt)) return 0
  const left = RESEND_COOLDOWN_SECONDS - Math.floor((now - sentAt) / 1000)
  return Math.min(RESEND_COOLDOWN_SECONDS, Math.max(0, left))
}

/** sessionStorage keys that carry the address from step 1 to step 2. */
export const RESET_EMAIL_KEY = "planora-reset-email"
export const RESET_SENT_AT_KEY = "planora-reset-sent-at"
