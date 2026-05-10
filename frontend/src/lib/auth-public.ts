import axios from "axios"
import type { AuthTokenDto, TokenValidationDto } from "@/types/auth"
import { getApiBaseUrl } from "@/lib/config"
import { clearCsrfToken, CSRF_HEADER_NAME, getCsrfToken } from "@/lib/csrf"

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
    const message = error instanceof Error ? error.message : "unknown error"
    throw new Error(`Unable to prepare CSRF token for auth request: ${message}`)
  }
}

const isCsrfForbidden = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false
  const response = (error as { response?: { status?: number } }).response
  return response?.status === 403
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
    if (!isCsrfForbidden(error)) {
      throw error
    }

    clearCsrfToken()
    return authPublic.post<T>(url, body, {
      headers: await csrfHeaders(headers),
    })
  }
}

const requestAccessTokenRefresh = async (): Promise<AuthTokenDto> => {
  const res = await postWithCsrfRetry("/auth/api/v1/auth/refresh", {})
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
  refreshRequest = refreshRequest ?? requestAccessTokenRefresh().finally(() => {
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
