import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { refreshAccessToken, validateAccessToken } from "@/lib/auth-public"
import { useAuthStore, type AuthPayload } from "@/store/auth"

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
    emailVerified: true,
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
  })

  afterEach(() => {
    vi.useRealTimers()
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
        emailVerified: undefined,
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
        emailVerified: false,
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

  it("preserves existing metadata when refresh token has partial claims", () => {
    useAuthStore.getState().setAuth({
      accessToken: authToken({ roles: ["User"], emailVerified: true }),
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    })

    useAuthStore.getState().applyRefresh({
      accessToken: authToken({
        roles: undefined,
        emailVerified: undefined,
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
})
