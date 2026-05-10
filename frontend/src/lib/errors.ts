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
  fallback = "Произошла ошибка",
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

function getResponseStatus(err: unknown): number | undefined {
  const e = getErrorRecord(err)
  const response = e?.response
  if (!response || typeof response !== "object") return undefined

  const status = (response as Record<string, unknown>).status
  return typeof status === "number" ? status : undefined
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

export function isTwoFactorChallenge(err: unknown): boolean {
  const raw = getRawErrorText(err)
  return raw.includes("two-factor") || raw.includes("two factor") || raw.includes("2fa")
}

export function getLoginErrorMessage(err: unknown): string {
  if (isServerUnavailableError(err)) {
    return "Cannot reach the server. Check that the API is running and try again."
  }

  const status = getResponseStatus(err)
  if (status === 401 || status === 400) return "Incorrect email or password."
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
