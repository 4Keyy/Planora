/**
 * CSRF Token Management — Double-Submit Cookie Pattern
 *
 * How it works:
 * 1. The backend's GET /auth/api/v1/auth/csrf-token endpoint sets a readable (non-httpOnly)
 *    cookie named XSRF-TOKEN containing a cryptographically random value.
 * 2. On every state-modifying request, this module reads that cookie value and echoes it
 *    in the X-CSRF-Token request header.
 * 3. The CsrfProtectionMiddleware on the backend validates that the header value matches
 *    the cookie value using a constant-time comparison.
 *
 * Why this prevents CSRF:
 * A cross-site attacker's page can trigger a request that automatically carries the browser's
 * cookies, but it cannot READ the XSRF-TOKEN cookie value (SameSite=Strict + same-origin
 * cookie policy), so it cannot set the matching X-CSRF-Token header.
 *
 * SECURITY: This pattern does NOT protect against XSS — if an attacker has XSS they can also
 * read the XSRF-TOKEN cookie and set the header. XSS is mitigated separately via CSP and
 * by storing the auth token in an httpOnly cookie (not readable by JS).
 */

import { getApiBaseUrl } from "@/lib/config"

export const CSRF_HEADER_NAME = 'X-CSRF-Token'
const XSRF_COOKIE_NAME = 'XSRF-TOKEN'

const CSRF_ENDPOINT = () => `${getApiBaseUrl()}/auth/api/v1/auth/csrf-token`
let csrfTokenRequest: Promise<string> | null = null

/**
 * Read the XSRF-TOKEN cookie value set by the backend.
 * Returns null if the cookie is not present (e.g. before first visit or after expiry).
 */
function readXsrfCookie(): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${XSRF_COOKIE_NAME}=`))
  if (!match) return null

  const separatorIndex = match.indexOf("=")
  return decodeURIComponent(match.slice(separatorIndex + 1))
}

/**
 * Fetches a fresh CSRF token from the backend.
 * The backend will set the XSRF-TOKEN cookie in the response.
 * The cookie value is what we echo in subsequent request headers.
 */
export async function fetchCsrfToken(): Promise<string> {
  csrfTokenRequest = csrfTokenRequest ?? (async () => {
    const response = await fetch(CSRF_ENDPOINT(), {
      method: "GET",
      credentials: "include", // Required so the Set-Cookie response header is accepted
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch CSRF token: ${response.status}`)
    }

    // After the response, the browser has set the XSRF-TOKEN cookie. Read it.
    const token = readXsrfCookie()
    if (!token) {
      throw new Error("XSRF-TOKEN cookie was not set by the server")
    }
    return token
  })().finally(() => {
    csrfTokenRequest = null
  })

  return csrfTokenRequest
}

/**
 * Gets the current CSRF token to echo in the X-CSRF-Token header.
 * Reads from the XSRF-TOKEN cookie; fetches a new one if not available.
 */
export async function getCsrfToken(): Promise<string> {
  const cookie = readXsrfCookie()
  if (cookie) return cookie
  // Cookie is absent — fetch a new one (backend will set it)
  return fetchCsrfToken()
}

/**
 * Clears the readable CSRF cookie so the next state-changing request fetches a new token.
 * This does not cancel an in-flight token fetch; sharing that request avoids issuing two
 * different CSRF cookies during app startup.
 */
export function clearCsrfToken(): void {
  if (typeof document === "undefined") return
  document.cookie = `${XSRF_COOKIE_NAME}=; Max-Age=0; path=/`
}

/**
 * Checks if a request needs CSRF token protection.
 * State-modifying requests (POST, PUT, DELETE, PATCH) require tokens.
 */
export function shouldIncludeCsrfToken(method: string): boolean {
  return ["POST", "PUT", "DELETE", "PATCH"].includes(method.toUpperCase())
}
