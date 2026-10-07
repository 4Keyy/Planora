import axios, { AxiosError } from "axios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const post = vi.fn()
  const create = vi.fn(() => ({ post }))
  const getCsrfToken = vi.fn()
  const clearCsrfToken = vi.fn()
  return { post, create, getCsrfToken, clearCsrfToken }
})

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>()
  return { ...actual, default: { ...actual.default, create: mocks.create } }
})

vi.mock("@/lib/csrf", () => ({
  CSRF_HEADER_NAME: "X-CSRF-Token",
  clearCsrfToken: mocks.clearCsrfToken,
  getCsrfToken: mocks.getCsrfToken,
}))

import { getAuthRetryAfterMs, refreshAccessToken, validateAccessToken } from "@/lib/auth-public"
import { useAuthStore } from "@/store/auth"

const limited = (header?: string) => new AxiosError("rate limited", undefined, undefined, undefined, {
  status: 429, statusText: "Too Many Requests", headers: header ? { "retry-after": header } : {},
  config: { headers: new axios.AxiosHeaders() }, data: undefined,
})

describe("auth public client", () => {
  afterEach(() => { vi.useRealTimers() })
  beforeEach(() => {
    mocks.post.mockReset()
    mocks.getCsrfToken.mockReset()
    mocks.clearCsrfToken.mockReset()
    mocks.getCsrfToken.mockResolvedValue("csrf-token")
  })

  it("creates a cookie-aware public auth client", () => {
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
        withCredentials: true,
      }),
    )
  })

  it("refreshes access tokens through the httpOnly cookie contract", async () => {
    mocks.post.mockResolvedValue({ data: { success: true, data: { accessToken: "new-access-token" } } })

    await expect(refreshAccessToken()).resolves.toEqual({ accessToken: "new-access-token" })

    expect(mocks.getCsrfToken).toHaveBeenCalledOnce()
    expect(mocks.post).toHaveBeenCalledWith(
      "/auth/api/v1/auth/refresh",
      {},
      { headers: { "X-CSRF-Token": "csrf-token" } },
    )
  })

  it("unwraps value-wrapped refresh responses", async () => {
    mocks.post.mockResolvedValue({ data: { value: { accessToken: "value-access-token" } } })

    await expect(refreshAccessToken()).resolves.toEqual({ accessToken: "value-access-token" })
  })

  it("treats no-content refresh responses as no restorable session", async () => {
    mocks.post.mockResolvedValue({ status: 204, data: "" })

    await expect(refreshAccessToken()).rejects.toThrow("No refresh session is available")
  })

  it("shares concurrent refresh calls so refresh-token rotation happens once", async () => {
    mocks.post.mockResolvedValue({ data: { accessToken: "shared-access-token" } })

    await expect(Promise.all([refreshAccessToken(), refreshAccessToken()])).resolves.toEqual([
      { accessToken: "shared-access-token" },
      { accessToken: "shared-access-token" },
    ])
    expect(mocks.getCsrfToken).toHaveBeenCalledOnce()
    expect(mocks.post).toHaveBeenCalledOnce()
  })

  it("retries refresh once with a new CSRF token after a CSRF 403", async () => {
    mocks.getCsrfToken
      .mockResolvedValueOnce("stale-csrf-token")
      .mockResolvedValueOnce("fresh-csrf-token")
    mocks.post
      .mockRejectedValueOnce({
        response: {
          status: 403,
          data: { error: "CSRF_VALIDATION_FAILED" },
        },
      })
      .mockResolvedValueOnce({ data: { accessToken: "retried-access-token" } })

    await expect(refreshAccessToken()).resolves.toEqual({ accessToken: "retried-access-token" })

    expect(mocks.clearCsrfToken).toHaveBeenCalledOnce()
    expect(mocks.post).toHaveBeenNthCalledWith(
      1,
      "/auth/api/v1/auth/refresh",
      {},
      { headers: { "X-CSRF-Token": "stale-csrf-token" } },
    )
    expect(mocks.post).toHaveBeenNthCalledWith(
      2,
      "/auth/api/v1/auth/refresh",
      {},
      { headers: { "X-CSRF-Token": "fresh-csrf-token" } },
    )
  })

  it("surfaces CSRF preparation failures before auth refresh requests", async () => {
    mocks.getCsrfToken.mockRejectedValue(new Error("csrf endpoint unavailable"))

    await expect(refreshAccessToken()).rejects.toThrow(
      "Unable to prepare CSRF token for auth request: csrf endpoint unavailable",
    )
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it("validates access tokens through Authorization and CSRF headers, not request body", async () => {
    mocks.post.mockResolvedValue({ data: { isValid: true, roles: ["User"] } })

    await expect(validateAccessToken("access-token")).resolves.toEqual({
      isValid: true,
      roles: ["User"],
    })

    expect(mocks.post).toHaveBeenCalledWith(
      "/auth/api/v1/auth/validate-token",
      {},
      { headers: { Authorization: "Bearer access-token", "X-CSRF-Token": "csrf-token" } },
    )
  })

  it("unwraps meta-keyed API response shapes", async () => {
    mocks.post.mockResolvedValue({
      data: { meta: { page: 1 }, data: { accessToken: "meta-access-token" } },
    })

    await expect(refreshAccessToken()).resolves.toEqual({ accessToken: "meta-access-token" })
  })

  it("surfaces CSRF preparation failures when a non-Error value is thrown", async () => {
    mocks.getCsrfToken.mockRejectedValue("plain string error")

    await expect(refreshAccessToken()).rejects.toThrow(
      "Unable to prepare CSRF token for auth request: unknown error",
    )
  })

  it.each(["csrf", "refresh"])("waits before one shared refresh retry after a %s 429", async (surface) => {
    vi.useFakeTimers()
    const error = limited("2")
    if (surface === "csrf") mocks.getCsrfToken.mockRejectedValueOnce(error)
    else mocks.post.mockRejectedValueOnce(error)
    mocks.post.mockResolvedValue({ status: 200, data: { accessToken: "after-cooldown" } })
    const first = refreshAccessToken()
    const second = refreshAccessToken()
    const result = Promise.all([first, second]).catch(value => value)
    await vi.advanceTimersByTimeAsync(2000)
    expect(mocks.post).toHaveBeenCalledTimes(surface === "csrf" ? 0 : 1)
    await vi.advanceTimersByTimeAsync(100)
    await expect(result).resolves.toEqual([
      { accessToken: "after-cooldown" }, { accessToken: "after-cooldown" },
    ])
    expect(mocks.post).toHaveBeenCalledTimes(surface === "csrf" ? 1 : 2)
  })

  it.each(["csrf", "refresh"])("keeps a cold session pending until a %s cooldown finishes", async (surface) => {
    vi.useFakeTimers()
    useAuthStore.setState({ user: { userId: "restored", email: "user@example.test", firstName: "Test", lastName: "User" },
      accessToken: undefined, isAuthenticated: false, hasHydrated: true, hasRestoredSession: false })
    const error = limited("2")
    if (surface === "csrf") mocks.getCsrfToken.mockRejectedValueOnce(error)
    else mocks.post.mockRejectedValueOnce(error)
    const jwtPart = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/," ").trim()
    const token = jwtPart({ alg: "none" }) + "." + jwtPart({ sub: "restored", exp: Math.floor(Date.now()/1000)+3600 }) + ".signature"
    mocks.post.mockResolvedValue({ status: 200, data: { accessToken: token } })
    const restored = useAuthStore.getState().restoreSession()
    await vi.advanceTimersByTimeAsync(2000)
    expect(useAuthStore.getState().hasRestoredSession).toBe(false)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    await restored
    expect(useAuthStore.getState().hasRestoredSession).toBe(true)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().accessToken).toBe(token)
  })

  it("surfaces a repeated 429 after one retry without an unbounded loop", async () => {
    vi.useFakeTimers()
    const error = limited("1")
    mocks.post.mockRejectedValue(error)
    const result = refreshAccessToken().catch(value => value)
    await vi.advanceTimersByTimeAsync(1100)
    expect(await result).toBe(error)
    expect(mocks.post).toHaveBeenCalledTimes(2)
  })

  it.each([401, 503])("does not retry refresh after HTTP %s", async (status) => {
    const error = limited("1")
    error.response!.status = status
    mocks.post.mockRejectedValue(error)
    await expect(refreshAccessToken()).rejects.toBe(error)
    expect(mocks.post).toHaveBeenCalledOnce()
  })

  it("reads seconds and HTTP dates and bounds invalid Retry-After values", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-07T19:00:00Z"))
    expect(getAuthRetryAfterMs(limited("2"))).toBe(2000)
    expect(getAuthRetryAfterMs(limited("Wed, 07 Oct 2026 19:00:03 GMT"))).toBe(3000)
    expect(getAuthRetryAfterMs(limited("0"))).toBe(1000)
    expect(getAuthRetryAfterMs(limited("9000"))).toBe(300000)
    expect(getAuthRetryAfterMs(limited("garbage"))).toBe(60000)
    expect(getAuthRetryAfterMs(limited())).toBe(60000)
    expect(getAuthRetryAfterMs(null)).toBe(60000)
  })

  it("rethrows non-CSRF errors without retrying", async () => {
    mocks.post.mockRejectedValueOnce(null)

    await expect(refreshAccessToken()).rejects.toBeNull()
    expect(mocks.post).toHaveBeenCalledOnce()
  })
})
