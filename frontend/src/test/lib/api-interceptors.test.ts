import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { refreshAccessToken } from "@/lib/auth-public"
import { clearCsrfToken, CSRF_HEADER_NAME, getCsrfToken } from "@/lib/csrf"
import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"

vi.mock("@/lib/auth-public", () => ({
  refreshAccessToken: vi.fn(),
  validateAccessToken: vi.fn(),
}))

vi.mock("@/lib/csrf", () => ({
  CSRF_HEADER_NAME: "X-CSRF-Token",
  clearCsrfToken: vi.fn(),
  getCsrfToken: vi.fn(),
  shouldIncludeCsrfToken: (method: string) => ["POST", "PUT", "DELETE", "PATCH"].includes(method.toUpperCase()),
}))

const base64Url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const token = (overrides: Record<string, unknown> = {}) =>
  `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: "user-1",
    email: "user@example.com",
    firstName: "First",
    lastName: "Last",
    exp: Math.floor(Date.now() / 1000) + 3600,
    roles: ["User"],
    email_verified: "true",
    ...overrides,
  })}.signature`

const requestFulfilled = () =>
  (api.interceptors.request as any).handlers.find((handler: any) => handler.fulfilled)?.fulfilled

const requestRejected = () =>
  (api.interceptors.request as any).handlers.find((handler: any) => handler.rejected)?.rejected

const responseRejected = () =>
  (api.interceptors.response as any).handlers.find((handler: any) => handler.rejected)?.rejected

const resetAuthState = () => {
  useAuthStore.setState({
    user: undefined,
    accessToken: undefined,
    accessTokenExpiresAt: undefined,
    refreshTokenExpiresAt: undefined,
    roles: [],
    emailVerified: undefined,
    isAuthenticated: false,
    hasHydrated: false,
    hasRestoredSession: false,
  })
}

describe("api interceptors", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthState()
    window.history.pushState({}, "", "/dashboard")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("adds authorization and CSRF headers to state-changing requests", async () => {
    useAuthStore.setState({ accessToken: "access-token" })
    vi.mocked(getCsrfToken).mockResolvedValue("csrf-token")

    const config = await requestFulfilled()({ method: "post", headers: {} })

    expect(config.headers.Authorization).toBe("Bearer access-token")
    expect(config.headers[CSRF_HEADER_NAME]).toBe("csrf-token")
    expect(getCsrfToken).toHaveBeenCalledOnce()
  })

  it("does not request a CSRF token for safe methods", async () => {
    const config = await requestFulfilled()({ method: "get", headers: {} })

    expect(config.headers[CSRF_HEADER_NAME]).toBeUndefined()
    expect(getCsrfToken).not.toHaveBeenCalled()
  })

  it("keeps the request flowing when CSRF prefetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(getCsrfToken).mockRejectedValue(new Error("csrf unavailable"))

    const config = await requestFulfilled()({ method: "delete", headers: {} })

    expect(config.method).toBe("delete")
    expect(errorSpy).toHaveBeenCalledWith("[API] Failed to add CSRF token:", expect.any(Error))
  })

  it("propagates request interceptor setup errors", async () => {
    const error = new Error("bad request config")

    await expect(requestRejected()(error)).rejects.toBe(error)
  })

  it.each([
    "/auth/api/v1/auth/login",
    "/auth/api/v1/auth/register",
    "/auth/api/v1/auth/logout",
    "/auth/api/v1/auth/refresh",
  ])("does not refresh or redirect-loop for auth endpoint 401 responses from %s", async (url) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = {
      response: { status: 401 },
      config: { url, method: "post" },
    }

    await expect(responseRejected()(error)).rejects.toBe(error)

    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(clearCsrfToken).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalledWith("[API Error]", expect.anything())
  })

  it("propagates protected 401 responses that have no retryable request config", async () => {
    const error = {
      response: { status: 401 },
      config: undefined,
    }

    await expect(responseRejected()(error)).rejects.toBe(error)

    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it("refreshes once on protected 401 responses and retries the original request", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const refreshed = token({ sub: "new-user", email: "new@example.com" })
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: refreshed })
    const adapter = vi.fn().mockResolvedValue({
      data: { ok: true },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    })
    const originalRequest = {
      url: "/todos/api/v1/todos",
      method: "get",
      headers: {} as Record<string, string>,
      adapter,
    }

    const result = await responseRejected()({
      response: { status: 401 },
      config: originalRequest,
    })

    expect(refreshAccessToken).toHaveBeenCalledOnce()
    expect(originalRequest).toMatchObject({ _retry: true })
    expect(originalRequest.headers.Authorization).toBe(`Bearer ${refreshed}`)
    expect(adapter).toHaveBeenCalledOnce()
    expect(result.data).toEqual({ ok: true })
    expect(useAuthStore.getState().accessToken).toBe(refreshed)
    expect(errorSpy).not.toHaveBeenCalledWith("[API Error]", expect.anything())
  })

  it("clears auth and CSRF state when protected 401 refresh fails", async () => {
    useAuthStore.setState({
      accessToken: "expired-token",
      isAuthenticated: true,
      roles: ["User"],
    })
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("expired cookie"))

    const error = {
      response: { status: 401 },
      config: { url: "/todos/api/v1/todos", method: "get", headers: {} },
    }

    await expect(responseRejected()(error)).rejects.toBe(error)

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(clearCsrfToken).toHaveBeenCalledOnce()
  })

  it("clears CSRF token on a state-changing 403 and marks the request for one retry", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    // First 403 on a POST: interceptor must call clearCsrfToken, mark
    // _csrfRetry on the config, and re-issue the request via api(originalRequest).
    // We do not assert on the inner api() resolution here (that requires a full
    // axios adapter stub); the interceptor contract under test is "side-effects
    // happen and a non-rejected promise is returned".
    const config: any = { method: "post", headers: {} }
    const forbiddenFirst = { response: { status: 403 }, config } as any

    const result = responseRejected()(forbiddenFirst)
    expect(clearCsrfToken).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith("[API] 403 — retrying with fresh CSRF token")
    expect(config._csrfRetry).toBe(true)
    // The retried request is fire-and-forget for the purposes of this test —
    // detach it so it does not surface as an unhandled rejection in jsdom.
    void result.catch(() => {})

    // Second 403 on the same request (now flagged _csrfRetry=true): interceptor
    // must NOT retry again — the rejection propagates to the caller.
    const forbiddenSecond = { response: { status: 403 }, config: { method: "post", headers: {}, _csrfRetry: true } } as any
    await expect(responseRejected()(forbiddenSecond)).rejects.toBe(forbiddenSecond)
    expect(warnSpy).toHaveBeenCalledWith("[API] 403 — not retried (non-mutating, retry already attempted, or no config)")

    // Outside production a no-response network error is logged via console.warn
    // (not console.error) so backend hot-reload restarts don't raise the Next.js
    // dev error overlay. The test environment is non-production.
    const network = { request: {}, message: "offline" }
    await expect(responseRejected()(network)).rejects.toBe(network)
    expect(warnSpy).toHaveBeenCalledWith("[Network Error]", "offline")

    const setupError = { message: "bad config" }
    await expect(responseRejected()(setupError)).rejects.toBe(setupError)
    expect(errorSpy).toHaveBeenCalledWith("[Request Error]", "bad config")
  })

  it("logs server and non-auth client errors without invoking refresh", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const serverError = {
      response: { status: 500 },
      config: { method: "get", url: "/todos/api/v1/todos" },
    }
    await expect(responseRejected()(serverError)).rejects.toBe(serverError)
    expect(errorSpy).toHaveBeenCalledWith("[API Error]", {
      status: 500,
      method: "get",
      url: "/todos/api/v1/todos",
    })

    const validationError = {
      response: { status: 422 },
      config: { method: "post", url: "/todos/api/v1/todos" },
    }
    await expect(responseRejected()(validationError)).rejects.toBe(validationError)
    expect(warnSpy).toHaveBeenCalledWith("[API Response]", {
      status: 422,
      method: "post",
      url: "/todos/api/v1/todos",
    })
    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it("clears auth on repeated protected 401 responses", async () => {
    useAuthStore.setState({
      accessToken: "expired-token",
      isAuthenticated: true,
      roles: ["User"],
    })
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const error = {
      response: { status: 401 },
      config: { url: "/todos/api/v1/todos", method: "get", headers: {}, _retry: true },
    }

    await expect(responseRejected()(error)).rejects.toBe(error)

    expect(warnSpy).toHaveBeenCalledWith("[API] Unauthorized - clearing auth")
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(clearCsrfToken).toHaveBeenCalledOnce()
  })

  // A best-effort background poll (notification summary while the WebSocket is down) is marked
  // suppressErrorLog. A 401 on it must NOT drive the global refresh/logout flow — otherwise the
  // 20s poll stampedes /auth/refresh into the per-IP rate limit and logs the user out mid-session.
  it("does not refresh or log out on a 401 from a best-effort background request", async () => {
    useAuthStore.setState({ accessToken: "expired-token", isAuthenticated: true, roles: ["User"] })

    const error = {
      response: { status: 401 },
      config: {
        url: "/realtime/api/v1/notifications/summary",
        method: "get",
        headers: {},
        suppressErrorLog: true,
      },
    }

    await expect(responseRejected()(error)).rejects.toBe(error)

    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(clearCsrfToken).not.toHaveBeenCalled()
  })

  // NOTE: this test intentionally runs last — the 429 path opens a module-level back-off window
  // (refreshBlockedUntil) that suppresses subsequent refreshes for up to 60s. Keeping it at the end
  // prevents that leaked state from starving the refresh-expecting tests above.
  //
  // A 429 on /auth/refresh is a transient per-IP rate limit, not an invalid session: the user must
  // stay logged in (the httpOnly refresh cookie is still good), and the client must back off rather
  // than re-hammer /auth/refresh (which is what tripped the limit in the first place).
  it("preserves the session on a 429 and backs off further refreshes", async () => {
    useAuthStore.setState({ accessToken: "expired-token", isAuthenticated: true, roles: ["User"] })
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(refreshAccessToken).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 429, headers: { "retry-after": "60" } },
    })

    const makeError = () => ({
      response: { status: 401 },
      config: { url: "/todos/api/v1/todos", method: "get", headers: {} },
    })

    // First 401 → refresh → 429: session preserved, back-off window opened.
    await expect(responseRejected()(makeError())).rejects.toBeDefined()
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(clearCsrfToken).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      "[API] Token refresh rate-limited (429) — backing off, session preserved",
    )

    // Second 401 within the window must short-circuit without calling refresh again.
    await expect(responseRejected()(makeError())).rejects.toBeDefined()
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})
