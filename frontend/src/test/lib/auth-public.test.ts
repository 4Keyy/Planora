import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const post = vi.fn()
  const create = vi.fn(() => ({ post }))
  const getCsrfToken = vi.fn()
  const clearCsrfToken = vi.fn()
  return { post, create, getCsrfToken, clearCsrfToken }
})

vi.mock("axios", () => ({
  default: {
    create: mocks.create,
  },
}))

vi.mock("@/lib/csrf", () => ({
  CSRF_HEADER_NAME: "X-CSRF-Token",
  clearCsrfToken: mocks.clearCsrfToken,
  getCsrfToken: mocks.getCsrfToken,
}))

import { refreshAccessToken, validateAccessToken } from "@/lib/auth-public"

describe("auth public client", () => {
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
})
