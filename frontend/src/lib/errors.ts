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

export function getLoginErrorMessage(err: unknown): string {
  if (isServerUnavailableError(err)) {
    return "Cannot reach the server. Check that the API is running and try again."
  }

  const status = getResponseStatus(err)
  // 401 is "those credentials are wrong". 400 is "that request was malformed", which is
  // not the user's password — reporting it as one sends them off to reset a password
  // that was never the problem.
  if (status === 401) return "Incorrect email or password."
  if (status === 400) return "Something went wrong on our side. Try again in a moment."
  if (status === 403) return "Account is locked. Please contact support."
  if (status && status >= 500) return "Server error. Please try again later."

  return "Unable to sign in. Please try again."
}

export function getRegisterErrorMessage(err: unknown): string {
  if (isServerUnavailableError(err)) {
    return "Cannot reach the server. Check that the API is running and try again."
  }

  const status = getResponseStatus(err)
  if (status === 409) return "An account with this email already exists."
  if (status === 400) return "Invalid information. Please check your details."
  if (status && status >= 500) return "Server error. Please try again later."

  return "Unable to create account. Please try again."
}
