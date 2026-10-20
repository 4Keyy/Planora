import axios from "axios"
import type { AuthTokenDto, TokenValidationDto } from "@/types/auth"
import { getApiBaseUrl } from "@/lib/config"
import { clearCsrfToken, CSRF_HEADER_NAME, getCsrfToken, isCsrfRejection } from "@/lib/csrf"

const authPublic = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 10000,
  // SECURITY: credentials: 'include' causes the browser to attach httpOnly cookies
  // (including the refresh-token cookie) on cross-origin requests to the API.
  // This is how silent token refresh works without exposing the refresh token to JS.
  withCredentials: true,
})

let refreshRequest: Promise<AuthTokenDto> | null = null

/** The Web Lock every tab of this origin holds while it refreshes — see `withRefreshLock`. */
export const AUTH_REFRESH_LOCK = "planora:auth-refresh"

/**
 * Runs `task` holding the origin-wide refresh lock, so the tabs of one browser refresh one after
 * another. Every refresh rotates the httpOnly cookie, and the server treats a refresh token
 * presented after its rotation as stolen: it revokes every session of the user and rotates their
 * security stamp. Two tabs refreshing at the same moment (restored together after a browser
 * restart, or both meeting an expired token) send the same cookie, and the slower request would
 * sign the user out everywhere. Under the lock the second request leaves only after the first
 * response has set the new cookie. Without Web Locks — an insecure origin such as a LAN IP over
 * plain http, or an older browser — it runs directly, as before.
 */
const withRefreshLock = async <T,>(task: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks
  if (!locks || typeof locks.request !== "function") return task()
  return await locks.request(AUTH_REFRESH_LOCK, { mode: "exclusive" }, task)
}

const unwrap = <T,>(data: unknown): T => {
  if (data && typeof data === "object" && "value" in data) {
    return (data as { value: T }).value
  }
  if (
    data &&
    typeof data === "object" &&
    "data" in data &&
    ("success" in data || "meta" in data || "error" in data)
  ) {
    return (data as { data: T }).data
  }
  return data as T
}

const csrfHeaders = async (headers: Record<string, string> = {}) => {
  try {
    return {
      ...headers,
      [CSRF_HEADER_NAME]: await getCsrfToken(),
    }
  } catch (error) {
    if (axios.isAxiosError(error)) throw error
    const message = error instanceof Error ? error.message : "unknown error"
    throw new Error(`Unable to prepare CSRF token for auth request: ${message}`)
  }
}


const postWithCsrfRetry = async <T,>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  try {
    return await authPublic.post<T>(url, body, {
      headers: await csrfHeaders(headers),
    })
  } catch (error) {
    // Only a CSRF 403 is worth a second try: a locked account also answers 403, and repeating
    // that sign-in would send the password twice.
    if (!isCsrfRejection(error)) {
      throw error
    }

    clearCsrfToken()
    return authPublic.post<T>(url, body, {
      headers: await csrfHeaders(headers),
    })
  }
}

/** Respect the gateway window while bounding malformed or excessive Retry-After values. */
export const getAuthRetryAfterMs = (error: unknown): number => {
  const header = (error as { response?: { headers?: Record<string, unknown> } } | null)?.response?.headers?.["retry-after"]
  const raw = typeof header === "string" ? header : ""
  const seconds = /^\d+(?:\.\d+)?$/.test(raw)
    ? Number(raw)
    : (Date.parse(raw) - Date.now()) / 1000
  return (Number.isFinite(seconds) ? Math.min(Math.max(seconds, 1), 300) : 60) * 1000
}

const requestAccessTokenRefresh = async (): Promise<AuthTokenDto> => {
  let res
  try {
    res = await postWithCsrfRetry("/auth/api/v1/auth/refresh", {})
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 429) throw error
    // The shared refresh remains pending, so a cold AuthGuard cannot redirect before a token
    // is obtained. Retry once; repeated limits and genuine auth failures remain visible.
    await new Promise<void>((resolve) => setTimeout(resolve, getAuthRetryAfterMs(error) + 100))
    res = await postWithCsrfRetry("/auth/api/v1/auth/refresh", {})
  }
  if (res.status === 204) {
    throw new Error("No refresh session is available")
  }
  return unwrap<AuthTokenDto>(res.data)
}

/**
 * Silently refresh the access token.
 * SECURITY: No refresh token string is passed as an argument — the browser automatically
 * sends the httpOnly refresh-token cookie. The raw token is never accessible to JavaScript.
 */
export async function refreshAccessToken(): Promise<AuthTokenDto> {
  // One request per tab (single-flight) and one tab at a time (the refresh lock).
  refreshRequest = refreshRequest ?? withRefreshLock(requestAccessTokenRefresh).finally(() => {
    refreshRequest = null
  })

  return refreshRequest
}

// SECURITY: Token sent in Authorization header, not the body, to avoid appearing in access logs.
// The backend endpoint must accept the token via the Authorization header.
export async function validateAccessToken(token: string): Promise<TokenValidationDto> {
  const res = await postWithCsrfRetry("/auth/api/v1/auth/validate-token", {}, {
    Authorization: `Bearer ${token}`,
  })
  return unwrap<TokenValidationDto>(res.data)
}
