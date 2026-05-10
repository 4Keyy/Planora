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
    emailVerified: true,
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

  it("clears CSRF token on 403 and logs network/request failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const forbidden = {
      response: { status: 403 },
      config: { method: "post" },
    }

    await expect(responseRejected()(forbidden)).rejects.toBe(forbidden)

    expect(clearCsrfToken).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith("[API] Forbidden - possible CSRF token failure")

    const network = { request: {}, message: "offline" }
    await expect(responseRejected()(network)).rejects.toBe(network)
    expect(errorSpy).toHaveBeenCalledWith("[Network Error]", "offline")

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
})
