import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getApiBaseUrl: vi.fn(() => "http://localhost:5132"),
  getCsrfToken: vi.fn(),
}))

vi.mock("@/lib/config", () => ({
  getApiBaseUrl: mocks.getApiBaseUrl,
}))

vi.mock("@/lib/csrf", () => ({
  CSRF_HEADER_NAME: "X-CSRF-Token",
  getCsrfToken: mocks.getCsrfToken,
}))

import { PRODUCT_EVENTS, trackProductEvent } from "@/lib/analytics"

describe("analytics client", () => {
  beforeEach(() => {
    mocks.getCsrfToken.mockReset()
    mocks.getCsrfToken.mockResolvedValue("csrf-token")
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
  })

  it("does not call authenticated analytics when no access token is available", async () => {
    trackProductEvent(PRODUCT_EVENTS.tokenRefreshFailed, { surface: "restore_session" })

    await Promise.resolve()

    expect(mocks.getCsrfToken).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("sends analytics events with CSRF and bearer token when authenticated", async () => {
    trackProductEvent(PRODUCT_EVENTS.sessionRestored, { method: "refresh" }, "access-token")

    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledOnce())

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5132/auth/api/v1/analytics/events",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-token",
          Authorization: "Bearer access-token",
        },
      }),
    )
  })
})
