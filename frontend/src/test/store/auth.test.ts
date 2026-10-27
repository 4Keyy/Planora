import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { refreshAccessToken, validateAccessToken } from "@/lib/auth-public"
import { useAuthStore, type AuthPayload } from "@/store/auth"
import { setDemoSession } from "@/lib/demo/flag"

vi.mock("@/lib/auth-public", () => ({
  refreshAccessToken: vi.fn(),
  validateAccessToken: vi.fn(),
}))

const base64Url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const token = (payload: Record<string, unknown>) =>
  `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url(payload)}.signature`

const futureEpoch = () => Math.floor(Date.now() / 1000) + 60 * 60
const pastEpoch = () => Math.floor(Date.now() / 1000) - 60

const authToken = (overrides: Record<string, unknown> = {}) =>
  token({
    sub: "user-1",
    email: "user@example.com",
    firstName: "First",
    lastName: "Last",
    exp: futureEpoch(),
    roles: ["User"],
    email_verified: "true",
    ...overrides,
  })

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

describe("auth store", () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
    resetAuthState()
    // A restore reports itself (`trackProductEvent`), which reads the CSRF token and posts. Without
    // the cookie and a stubbed fetch that went to a real gateway, and a send still on its way when
    // the next test stubbed fetch was counted there: the failed-restore tests below saw four
    // events instead of one whenever a gateway was slow or down.
    document.cookie = "XSRF-TOKEN=csrf; path=/"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })))
  })

  afterEach(() => {
    // Cancels this tab's scheduled refresh, so no timer outlives its test.
    useAuthStore.getState().clearAuth(true)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("sets auth from a JWT and never persists raw tokens", () => {
    const accessToken = authToken()
    const payload: AuthPayload = {
      accessToken,
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    }

    useAuthStore.getState().setAuth(payload)

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.accessToken).toBe(accessToken)
    expect(state.user).toEqual({
      userId: "user-1",
      email: "user@example.com",
      firstName: "First",
      lastName: "Last",
    })
    expect(state.roles).toEqual(["User"])
    expect(state.emailVerified).toBe(true)

    const persisted = sessionStorage.getItem("planora-auth") ?? ""
    const persistedState = JSON.parse(persisted).state
    expect(persisted).not.toContain(accessToken)
    expect(persistedState.accessToken).toBeUndefined()
    expect("refreshToken" in persistedState).toBe(false)
  })

  it("sets auth from explicit payload fields when token identity claims are incomplete", () => {
    useAuthStore.getState().setAuth({
      accessToken: authToken({
        sub: undefined,
        email: undefined,
        firstName: undefined,
        lastName: undefined,
        exp: undefined,
        roles: [],
        email_verified: undefined,
      }),
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      userId: "payload-user",
      email: "payload@example.com",
      firstName: "Payload",
      lastName: "User",
    })

    const state = useAuthStore.getState()
    expect(state.user).toEqual({
      userId: "payload-user",
      email: "payload@example.com",
      firstName: "Payload",
      lastName: "User",
    })
    expect(state.accessTokenExpiresAt).toBeUndefined()
    expect(state.roles).toEqual([])
    expect(state.emailVerified).toBeUndefined()
  })

  it("falls back to existing user metadata when refreshed login payload lacks identity", () => {
    useAuthStore.setState({
      user: {
        userId: "existing-user",
        email: "existing@example.com",
        firstName: "Existing",
        lastName: "User",
      },
    })

    useAuthStore.getState().setAuth({
      accessToken: authToken({
        sub: undefined,
        email: undefined,
        firstName: undefined,
        lastName: undefined,
      }),
    })

    expect(useAuthStore.getState().user).toEqual({
      userId: "existing-user",
      email: "existing@example.com",
      firstName: "Existing",
      lastName: "User",
    })
  })

  it("applies refreshed access tokens while preserving identity metadata", () => {
    useAuthStore.getState().setAuth({
      accessToken: authToken({ roles: ["User"] }),
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    })

    useAuthStore.getState().applyRefresh({
      accessToken: authToken({
        sub: "user-2",
        email: "new@example.com",
        firstName: "New",
        lastName: "Name",
        roles: ["Admin"],
        email_verified: "false",
      }),
      expiresAt: "2099-02-01T00:00:00.000Z",
    })

    const state = useAuthStore.getState()
    expect(state.user?.userId).toBe("user-2")
    expect(state.user?.email).toBe("new@example.com")
    expect(state.roles).toEqual(["Admin"])
    expect(state.emailVerified).toBe(false)
    expect(state.refreshTokenExpiresAt).toBe("2099-02-01T00:00:00.000Z")
  })

  it("keeps the existing avatar when refresh payload has no avatar claim", () => {
    useAuthStore.getState().setAuth({
      accessToken: authToken(),
      profilePictureUrl: "/avatars/original.png",
    })

    useAuthStore.getState().applyRefresh({
      accessToken: authToken({
        sub: "user-2",
        email: "new@example.com",
        firstName: "New",
        lastName: "Name",
      }),
    })

    expect(useAuthStore.getState().user).toMatchObject({
      userId: "user-2",
      email: "new@example.com",
      profilePictureUrl: "/avatars/original.png",
    })
  })

  it("preserves existing metadata when refresh token has partial claims", () => {
    useAuthStore.getState().setAuth({
      accessToken: authToken({ roles: ["User"], email_verified: "true" }),
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    })

    useAuthStore.getState().applyRefresh({
      accessToken: authToken({
        roles: undefined,
        email_verified: undefined,
        firstName: undefined,
      }),
    })

    const state = useAuthStore.getState()
    expect(state.roles).toEqual(["User"])
    expect(state.emailVerified).toBe(true)
    expect(state.refreshTokenExpiresAt).toBe("2099-01-01T00:00:00.000Z")
    expect(state.user?.firstName).toBe("First")
  })

  it("clears all in-memory auth state", () => {
    useAuthStore.getState().setAuth({
      accessToken: authToken(),
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    })

    useAuthStore.getState().clearAuth()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeUndefined()
    expect(state.accessToken).toBeUndefined()
    expect(state.roles).toEqual([])
  })

  it("updates the current user only when identity exists", () => {
    useAuthStore.getState().updateUser({ firstName: "Ignored" })
    expect(useAuthStore.getState().user).toBeUndefined()

    useAuthStore.getState().setAuth({ accessToken: authToken() })
    useAuthStore.getState().updateUser({ firstName: "Updated" })

    expect(useAuthStore.getState().user?.firstName).toBe("Updated")
  })

  it("validates a live access token during restore without refreshing", async () => {
    useAuthStore.getState().setAuth({ accessToken: authToken() })
    vi.mocked(validateAccessToken).mockResolvedValue({
      isValid: true,
      roles: ["ServerRole"],
    })

    await useAuthStore.getState().restoreSession()

    expect(validateAccessToken).toHaveBeenCalledOnce()
    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(useAuthStore.getState().roles).toEqual(["ServerRole"])
    expect(useAuthStore.getState().hasRestoredSession).toBe(true)
  })

  it("keeps a live access token when server validation is temporarily unreachable", async () => {
    useAuthStore.getState().setAuth({ accessToken: authToken() })
    vi.mocked(validateAccessToken).mockRejectedValue(new Error("network down"))

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().hasRestoredSession).toBe(true)
  })

  it("clears auth when server validation rejects the access token", async () => {
    useAuthStore.getState().setAuth({ accessToken: authToken() })
    vi.mocked(validateAccessToken).mockResolvedValue({ isValid: false })

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().hasRestoredSession).toBe(true)
  })

  it("silent refreshes through the httpOnly cookie when no valid access token exists", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: authToken({ sub: "restored-user", email: "restored@example.com" }),
      expiresAt: "2099-01-01T00:00:00.000Z",
    })

    await useAuthStore.getState().restoreSession()

    expect(refreshAccessToken).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().user?.userId).toBe("restored-user")
    expect(useAuthStore.getState().hasRestoredSession).toBe(true)
  })

  it("clears auth when silent refresh fails", async () => {
    useAuthStore.getState().setAuth({
      accessToken: authToken({ exp: pastEpoch() }),
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    })
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("cookie expired"))

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().accessToken).toBeUndefined()
    expect(useAuthStore.getState().hasRestoredSession).toBe(true)
  })

  // There is no working token to report a failed restore with, so the event waits for the next
  // session — the same person's (FE-17).
  describe("a failed restore, reported by the next session", () => {
    const pending = () => JSON.parse(sessionStorage.getItem("planora:pending-product-events") ?? "[]")

    beforeEach(() => {
      document.cookie = "XSRF-TOKEN=csrf; path=/"
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })))
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      sessionStorage.clear()
      setDemoSession(false)
    })

    const failRestore = async () => {
      useAuthStore.getState().setAuth({ accessToken: authToken({ exp: pastEpoch() }) })
      vi.mocked(refreshAccessToken).mockRejectedValue(new Error("cookie expired"))
      await useAuthStore.getState().restoreSession()
    }

    it("keeps the event, then sends it with the same user's next token", async () => {
      await failRestore()
      expect(pending()).toEqual([expect.objectContaining({ properties: { surface: "restore_session" }, userId: "user-1" })])
      expect(fetch).not.toHaveBeenCalled()

      const fresh = authToken()
      useAuthStore.getState().setAuth({ accessToken: fresh })

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
      const [url, init] = vi.mocked(fetch).mock.calls[0]
      expect(url).toContain("/auth/api/v1/analytics/events")
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${fresh}`)
      expect(JSON.parse(String(init?.body))).toMatchObject({ eventName: "TOKEN_REFRESH_FAILED" })
      expect(pending()).toEqual([])
    })

    it("does not report it under someone else's account", async () => {
      await failRestore()
      useAuthStore.getState().setAuth({ accessToken: authToken({ sub: "user-2" }) })

      await Promise.resolve()
      expect(fetch).not.toHaveBeenCalled()
      expect(pending()).toEqual([])
    })

    it("leaves it alone in the demo sandbox, which never reaches the network", async () => {
      await failRestore()
      setDemoSession(true)
      useAuthStore.getState().setAuth({ accessToken: authToken() })

      await Promise.resolve()
      expect(fetch).not.toHaveBeenCalled()
      expect(pending()).toHaveLength(1)
    })
  })

  it("preserves the session when silent refresh is rate-limited (429)", async () => {
    useAuthStore.getState().setAuth({
      accessToken: authToken({ exp: pastEpoch() }),
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    })
    // A 429 on /auth/refresh is a transient per-IP rate limit, not an invalid session — the
    // httpOnly refresh cookie is still good. Hard-logging-out here (and broadcasting logout to
    // every tab) would feed a reload → refresh → 429 loop, so the session must be preserved.
    vi.mocked(refreshAccessToken).mockRejectedValue({ response: { status: 429 } })

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().hasRestoredSession).toBe(true)
  })

  it("reports token validity with access-token and refresh-cookie expiry windows", () => {
    useAuthStore.getState().setAuth({
      accessToken: authToken({ exp: pastEpoch() }),
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    })

    expect(useAuthStore.getState().isRefreshTokenValid()).toBe(true)
    expect(useAuthStore.getState().isTokenValid()).toBe(true)

    useAuthStore.setState({ refreshTokenExpiresAt: "2000-01-01T00:00:00.000Z" })

    expect(useAuthStore.getState().isRefreshTokenValid()).toBe(false)
    expect(useAuthStore.getState().isTokenValid()).toBe(false)
  })

  it("treats authenticated access tokens without expiry as valid", () => {
    useAuthStore.setState({
      isAuthenticated: true,
      accessToken: "opaque-test-token",
      accessTokenExpiresAt: undefined,
    })

    expect(useAuthStore.getState().isTokenValid()).toBe(true)
  })

  it("rejects unauthenticated or refresh-expiry-less sessions as invalid", () => {
    expect(useAuthStore.getState().isTokenValid()).toBe(false)
    expect(useAuthStore.getState().isRefreshTokenValid()).toBe(false)

    useAuthStore.setState({
      isAuthenticated: true,
      accessToken: undefined,
      refreshTokenExpiresAt: undefined,
    })

    expect(useAuthStore.getState().isTokenValid()).toBe(false)
    expect(useAuthStore.getState().isRefreshTokenValid()).toBe(false)
  })

  it("marks restore complete for valid access tokens even when validation returns no roles", async () => {
    useAuthStore.getState().setAuth({ accessToken: authToken({ roles: ["LocalRole"] }) })
    vi.mocked(validateAccessToken).mockResolvedValue({
      isValid: true,
      roles: [],
    })

    await useAuthStore.getState().restoreSession()

    expect(validateAccessToken).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().roles).toEqual(["LocalRole"])
    expect(useAuthStore.getState().hasRestoredSession).toBe(true)
  })

  it("does not schedule refresh when access-token expiry is unknown", () => {
    useAuthStore.setState({
      isAuthenticated: true,
      accessToken: "opaque-test-token",
      accessTokenExpiresAt: undefined,
    })

    expect(useAuthStore.getState().scheduleTokenRefresh()).toBeUndefined()
  })

  it("schedules token refresh before access-token expiry and returns a cleanup function", async () => {
    vi.useFakeTimers()
    const firstToken = authToken({ exp: Math.floor(Date.now() / 1000) + 240 })
    const refreshedToken = authToken({ exp: Math.floor(Date.now() / 1000) + 3600 })
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: refreshedToken })
    useAuthStore.getState().setAuth({ accessToken: firstToken })

    const cleanup = useAuthStore.getState().scheduleTokenRefresh()

    expect(cleanup).toEqual(expect.any(Function))

    await vi.runOnlyPendingTimersAsync()

    expect(refreshAccessToken).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().accessToken).toBe(refreshedToken)
    cleanup?.()
  })

  it("retries scheduled refresh after a refresh failure", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const retriedToken = authToken({ exp: Math.floor(Date.now() / 1000) + 3600 })
    vi.mocked(refreshAccessToken)
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce({ accessToken: retriedToken })
    useAuthStore.getState().setAuth({
      accessToken: authToken({ exp: Math.floor(Date.now() / 1000) + 60 }),
    })

    const cleanup = useAuthStore.getState().scheduleTokenRefresh()

    await vi.runOnlyPendingTimersAsync()

    expect(refreshAccessToken).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith("Auto-refresh failed")

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    await vi.runOnlyPendingTimersAsync()

    expect(refreshAccessToken).toHaveBeenCalledTimes(2)
    expect(useAuthStore.getState().accessToken).toBe(retriedToken)

    cleanup?.()
    warn.mockRestore()
  })

  it("falls back to no-op storage when sessionStorage is unavailable", async () => {
    vi.resetModules()
    const originalSessionStorage = window.sessionStorage
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => {
          throw new Error("blocked")
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    })

    try {
      const { useAuthStore: isolatedAuthStore } = await import("@/store/auth")

      isolatedAuthStore.getState().setAuth({ accessToken: authToken() })
      ;(isolatedAuthStore as any).persist.clearStorage()

      expect(warn).toHaveBeenCalledWith("sessionStorage is not available, using memory storage")
      expect(isolatedAuthStore.getState().isAuthenticated).toBe(true)
    } finally {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        value: originalSessionStorage,
      })
      warn.mockRestore()
    }
  })

  it("handles a completely malformed access token without throwing", () => {
    useAuthStore.getState().setAuth({ accessToken: "not-a-jwt" })

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    // derivedUser is undefined (decodeJwt returns null for a non-JWT string),
    // no payload user fields, no existing state.user — user stays unset
    expect(state.user).toBeUndefined()
    expect(state.accessTokenExpiresAt).toBeUndefined()
    expect(state.roles).toEqual([])
  })

  it("applies refresh when refresh payload lacks user identity claims", () => {
    useAuthStore.getState().setAuth({ accessToken: authToken() })

    useAuthStore.getState().applyRefresh({
      accessToken: authToken({
        sub: undefined,
        email: undefined,
        firstName: undefined,
        lastName: undefined,
      }),
    })

    // derivedUser is undefined because required claims are missing;
    // existing user from setAuth should be preserved
    expect(useAuthStore.getState().user?.userId).toBe("user-1")
  })
})

describe("scheduled token refresh", () => {
  const MINUTE = 60 * 1000
  const inMinutes = (minutes: number) => authToken({ exp: Math.floor(Date.now() / 1000) + minutes * 60 })

  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
    resetAuthState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    useAuthStore.getState().clearAuth(true)
    setDemoSession(false)
    vi.useRealTimers()
  })

  it("is armed by a login without a reload", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: inMinutes(60) })
    useAuthStore.getState().setAuth({ accessToken: inMinutes(10) })

    await vi.advanceTimersByTimeAsync(5 * MINUTE)

    expect(refreshAccessToken).toHaveBeenCalledOnce()
  })

  it("keeps exactly one refresh pending however often it is armed", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: inMinutes(60) })
    useAuthStore.getState().setAuth({ accessToken: inMinutes(10) })
    useAuthStore.getState().scheduleTokenRefresh()
    useAuthStore.getState().scheduleTokenRefresh()

    await vi.advanceTimersByTimeAsync(5 * MINUTE)

    expect(refreshAccessToken).toHaveBeenCalledOnce()
  })

  it("schedules the next refresh after each successful one", async () => {
    vi.mocked(refreshAccessToken).mockImplementation(async () => ({ accessToken: inMinutes(10) }))
    useAuthStore.getState().setAuth({ accessToken: inMinutes(10) })

    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(refreshAccessToken).toHaveBeenCalledTimes(2)
  })

  it("stops on logout, including a retry already waiting after a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("refresh failed"))
    useAuthStore.getState().setAuth({ accessToken: inMinutes(1) })

    await vi.advanceTimersByTimeAsync(0)
    expect(refreshAccessToken).toHaveBeenCalledOnce()

    useAuthStore.getState().clearAuth(true)
    await vi.advanceTimersByTimeAsync(30 * MINUTE)

    expect(refreshAccessToken).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it("schedules nothing for the sandbox's seeded session", async () => {
    setDemoSession(true)
    useAuthStore.getState().setAuth({ accessToken: inMinutes(10) })

    expect(useAuthStore.getState().scheduleTokenRefresh()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60 * MINUTE)

    expect(refreshAccessToken).not.toHaveBeenCalled()
  })
})
