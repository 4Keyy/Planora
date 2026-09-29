/**
 * Safely extracts a plain string message from any thrown value.
 *
 * Priority:
 *   1. err.response.data.message  (Axios-style API error)
 *   2. err.response.data.error
 *   3. err.message                (native Error / custom Result type)
 *   4. fallback string
 *
 * Never returns a non-string, so it is safe to pass directly to
 * React state that ends up rendered in JSX.
 */
export function extractErrorMessage(
  err: unknown,
  fallback = "An error occurred",
): string {
  if (typeof err === "string") return err

  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>

    if (typeof e.response === "object" && e.response) {
      const r = e.response as Record<string, unknown>
      if (typeof r.data === "object" && r.data) {
        const d = r.data as Record<string, unknown>
        if (typeof d.message === "string") return d.message
        if (typeof d.error === "string") return d.error
        if (typeof d.detail === "string") return d.detail
      }
    }

    if (typeof e.message === "string") return e.message
  }

  return fallback
}

function getErrorRecord(err: unknown): Record<string, unknown> | null {
  return err && typeof err === "object" ? err as Record<string, unknown> : null
}

/**
 * True when the API rejected a viewer's reopen because the author has already completed the whole
 * task globally (`AUTHOR_ALREADY_COMPLETED`). The UI normally prevents this proactively via
 * `ownerCompleted`, so this is the server-side backstop for a stale client.
 */
export function isAuthorAlreadyCompletedError(err: unknown): boolean {
  const e = getErrorRecord(err)
  const data = e?.response && typeof e.response === "object"
    ? (e.response as Record<string, unknown>).data as Record<string, unknown> | undefined
    : undefined
  const nestedCode = data?.error && typeof data.error === "object"
    ? (data.error as Record<string, unknown>).code
    : undefined
  if (data?.code === "AUTHOR_ALREADY_COMPLETED" || nestedCode === "AUTHOR_ALREADY_COMPLETED") return true
  return extractErrorMessage(err, "").includes("AUTHOR_ALREADY_COMPLETED")
}

/**
 * Copy for the one refusal a viewer cannot act their way out of: the author closed the task
 * globally, so no collaborator can reopen their own copy of it. Four routes raise this — the
 * dashboard, both task lists and the branch page — and each carried its own transcription of
 * the sentence, which is how three of them ended up still in Russian after the UI moved to
 * English. One object, one wording, one place to change it.
 */
export const AUTHOR_COMPLETED_TOAST = {
  type: "warning",
  title: "Can't reopen — the author completed this task",
  description: "Make a copy to keep working on your own version.",
} as const

function getResponseStatus(err: unknown): number | undefined {
  const e = getErrorRecord(err)
  const response = e?.response
  if (!response || typeof response !== "object") return undefined

  const status = (response as Record<string, unknown>).status
  return typeof status === "number" ? status : undefined
}

/** The server's error code, from either shape the API uses. */
function getErrorCode(err: unknown): string | null {
  const e = getErrorRecord(err)
  const data = e?.response && typeof e.response === "object"
    ? ((e.response as Record<string, unknown>).data as Record<string, unknown> | undefined)
    : undefined
  const nested = data?.error && typeof data.error === "object"
    ? (data.error as Record<string, unknown>).code
    : undefined
  const code = data?.code ?? nested
  return typeof code === "string" ? code : null
}

function getRawErrorText(err: unknown): string {
  return extractErrorMessage(err, "").toLowerCase()
}

export function isServerUnavailableError(err: unknown): boolean {
  const e = getErrorRecord(err)
  if (!e || getResponseStatus(err)) return false

  const code = typeof e.code === "string" ? e.code : ""
  const message = typeof e.message === "string" ? e.message.toLowerCase() : ""

  return Boolean(
    e.request ||
      code === "ERR_NETWORK" ||
      code === "ECONNABORTED" ||
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("failed to fetch"),
  )
}

/**
 * A two-factor challenge, by error code where the server sends one.
 *
 * This used to be substring sniffing on the message alone, which makes the branch
 * hostage to prose: reword the server's sentence and the client silently stops asking
 * for the code, leaving the user staring at "Incorrect email or password" with a
 * correct password in the field. The code is checked first; the text stays as a
 * fallback for deployments still sending the older message, and dropping it would be a
 * behaviour change dressed up as a cleanup.
 */
export function isTwoFactorChallenge(err: unknown): boolean {
  if (getErrorCode(err) === "TWO_FACTOR_REQUIRED") return true
  const raw = getRawErrorText(err)
  return raw.includes("two-factor") || raw.includes("two factor") || raw.includes("2fa")
}

/** The one sentence every auth screen uses when the request never reached Planora. */
export const NETWORK_MESSAGE = "Can't reach Planora. Check your connection and try again."
const SERVER_MESSAGE = "Something went wrong on our side. Try again in a moment."
const RATE_LIMIT_MESSAGE = "Too many attempts. Wait a minute and try again."

export function getLoginErrorMessage(err: unknown): string {
  if (isServerUnavailableError(err)) return NETWORK_MESSAGE

  const status = getResponseStatus(err)
  // 401 is "those credentials are wrong". 400 is "that request was malformed", which is
  // not the user's password — reporting it as one sends them off to reset a password
  // that was never the problem.
  if (status === 401) return "That email and password don't match. Check both and try again."
  if (status === 400) return SERVER_MESSAGE
  // The lock lifts by itself (`AccountLockoutMinutes` on the server). "Contact support"
  // sent people looking for a support channel for something a clock resolves.
  if (status === 403) return "This account is locked after too many attempts. Try again in 30 minutes."
  if (status === 429) return RATE_LIMIT_MESSAGE
  if (status && status >= 500) return SERVER_MESSAGE

  return "Couldn't sign you in. Try again."
}

export function getRegisterErrorMessage(err: unknown): string {
  if (isServerUnavailableError(err)) return NETWORK_MESSAGE

  const status = getResponseStatus(err)
  if (status === 409) return "An account with this email already exists. Sign in instead."
  if (status === 400) return "Check your details and try again."
  if (status === 429) return RATE_LIMIT_MESSAGE
  if (status && status >= 500) return SERVER_MESSAGE

  return "Couldn't create the account. Try again."
}

export type ResetErrorKind =
  | "invalid-token"
  | "weak-password"
  | "compromised-password"
  | "rate-limited"
  | "network"
  | "unknown"

/**
 * Why a password reset was refused, so the page can put the message where the
 * problem is.
 *
 * The old page answered every failure with "Check the token and try again" — including
 * the server saying the NEW PASSWORD was too weak or had appeared in a breach, which sent
 * people to inspect a link that was fine. The server does not tell an expired link from
 * a used one (both are `INVALID_TOKEN`), so neither does this.
 */
export function getResetErrorKind(err: unknown): ResetErrorKind {
  if (isServerUnavailableError(err)) return "network"
  const code = getErrorCode(err)
  if (code === "WEAK_PASSWORD") return "weak-password"
  if (code === "COMPROMISED_PASSWORD") return "compromised-password"
  if (code === "INVALID_TOKEN") return "invalid-token"
  const status = getResponseStatus(err)
  if (status === 429) return "rate-limited"
  if (status === 401) return "invalid-token"
  return "unknown"
}

export type VerifyErrorKind = "invalid-token" | "network" | "unknown"

/**
 * Why an email verification link failed. The endpoint answers every bad link with a
 * 400 — expired, used, unknown and (a known server quirk) already verified — so any 400
 * is "this link did not work", and the page's copy covers the already-verified case.
 */
export function getVerifyErrorKind(err: unknown): VerifyErrorKind {
  if (isServerUnavailableError(err)) return "network"
  const status = getResponseStatus(err)
  if (getErrorCode(err) === "INVALID_TOKEN" || status === 400 || status === 401) return "invalid-token"
  return "unknown"
}

/** The sentence for a reset or resend refusal that has no field to sit on. */
export function getAuthRequestMessage(kind: "rate-limited" | "network" | "unknown"): string {
  if (kind === "network") return NETWORK_MESSAGE
  if (kind === "rate-limited") return "Too many requests. Wait a minute and try again."
  return SERVER_MESSAGE
}

/** The same, read straight from an error — for the "send me a link" requests. */
export function getLinkRequestMessage(err: unknown): string {
  if (isServerUnavailableError(err)) return NETWORK_MESSAGE
  return getResponseStatus(err) === 429 ? getAuthRequestMessage("rate-limited") : SERVER_MESSAGE
}

export type AccountChangeErrorKind =
  | "wrong-password"
  | "weak-password"
  | "compromised-password"
  | "reused-password"
  | "invalid-email"
  | "email-taken"
  | "rate-limited"
  | "network"
  | "unknown"

/**
 * Why a password or email change on the profile was refused, so the message can sit on
 * the field it is about. Both endpoints answer every refusal with a 400 carrying a code
 * (`ChangePasswordCommandHandler`, `ChangeEmailCommandHandler`); the old page reduced all
 * of them to "Failed to change password" in a toast that disappeared.
 */
export function getAccountChangeErrorKind(err: unknown): AccountChangeErrorKind {
  if (isServerUnavailableError(err)) return "network"
  switch (getErrorCode(err)) {
    case "INVALID_PASSWORD":
      return "wrong-password"
    case "WEAK_PASSWORD":
      return "weak-password"
    case "COMPROMISED_PASSWORD":
      return "compromised-password"
    case "PASSWORD_REUSED":
      return "reused-password"
    case "INVALID_EMAIL":
      return "invalid-email"
    case "EMAIL_EXISTS":
      return "email-taken"
  }
  return getResponseStatus(err) === 429 ? "rate-limited" : "unknown"
}
