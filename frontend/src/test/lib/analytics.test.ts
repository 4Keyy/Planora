import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

import { PRODUCT_EVENTS, flushQueuedProductEvents, queueProductEvent, trackProductEvent } from "@/lib/analytics"

describe("analytics client", () => {
  beforeEach(() => {
    mocks.getCsrfToken.mockReset()
    mocks.getCsrfToken.mockResolvedValue("csrf-token")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
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

  it("does nothing in a server-side environment where window is undefined", () => {
    vi.stubGlobal("window", undefined)

    trackProductEvent(PRODUCT_EVENTS.sessionRestored, {}, "access-token")

    expect(global.fetch).not.toHaveBeenCalled()
    expect(mocks.getCsrfToken).not.toHaveBeenCalled()
  })

  // A refresh that failed ended the session: its token is the one the API just rejected, and the
  // endpoint takes signed-in callers only. The event waits for the next session instead (FE-17).
  describe("events about a session that just ended", () => {
    const sent = () => vi.mocked(global.fetch).mock.calls.map(([, init]) => ({
      authorization: (init?.headers as Record<string, string>).Authorization,
      body: JSON.parse(String(init?.body)),
    }))

    it("keeps the event and sends it with the next session's token, as it happened", async () => {
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(new Date("2026-10-20T10:00:00.000Z"))
      queueProductEvent(PRODUCT_EVENTS.tokenRefreshFailed, { surface: "api_interceptor" }, "user-1")
      vi.useRealTimers()
      await Promise.resolve()
      expect(global.fetch).not.toHaveBeenCalled()

      flushQueuedProductEvents("fresh-token", "user-1")

      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledOnce())
      expect(sent()).toEqual([{
        authorization: "Bearer fresh-token",
        body: { eventName: "TOKEN_REFRESH_FAILED", properties: { surface: "api_interceptor" }, occurredAt: "2026-10-20T10:00:00.000Z" },
      }])

      flushQueuedProductEvents("fresh-token", "user-1")
      await Promise.resolve()
      expect(global.fetch).toHaveBeenCalledOnce() // sent once, then gone
    })

    it("does not send one person's event under another person's session", async () => {
      queueProductEvent(PRODUCT_EVENTS.tokenRefreshFailed, { surface: "restore_session" }, "user-1")
      queueProductEvent(PRODUCT_EVENTS.tokenRefreshFailed, { surface: "restore_session" })

      flushQueuedProductEvents("other-token", "user-2")

      // The event of an unknown session goes with the next one; user-1's is dropped, not kept.
      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledOnce())
      flushQueuedProductEvents("token-1", "user-1")
      await Promise.resolve()
      expect(global.fetch).toHaveBeenCalledOnce()
    })

    it("keeps at most the ten latest events", async () => {
      for (let i = 0; i < 12; i++) {
        queueProductEvent(PRODUCT_EVENTS.tokenRefreshFailed, { attempt: i }, "user-1")
      }

      flushQueuedProductEvents("fresh-token", "user-1")

      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(10))
      expect(sent().map((event) => event.body.properties.attempt)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    })

    it("survives unreadable storage", () => {
      sessionStorage.setItem("planora:pending-product-events", "not json")
      expect(() => flushQueuedProductEvents("fresh-token", "user-1")).not.toThrow()
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })
})
