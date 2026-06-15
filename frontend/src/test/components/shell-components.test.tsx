import { act, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SecurityInitializer } from "@/components/security-initializer"
import { getCsrfToken } from "@/lib/csrf"
import { useAuthStore } from "@/store/auth"

vi.mock("@/lib/csrf", () => ({
  getCsrfToken: vi.fn(),
}))

describe("shell components", () => {
  beforeEach(() => {
    vi.mocked(getCsrfToken).mockResolvedValue("csrf-token")
    useAuthStore.setState({
      hasHydrated: false,
      hasRestoredSession: false,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("initializes CSRF immediately and waits for hydration before restoring session", async () => {
    const restoreSession = vi.fn().mockResolvedValue(undefined)
    const cleanup = vi.fn()
    const scheduleTokenRefresh = vi.fn(() => cleanup)

    useAuthStore.setState({
      hasHydrated: true,
      restoreSession,
      scheduleTokenRefresh,
    } as Partial<ReturnType<typeof useAuthStore.getState>>)

    const { unmount } = render(<SecurityInitializer />)

    await waitFor(() => expect(getCsrfToken).toHaveBeenCalledOnce())
    await waitFor(() => expect(restoreSession).toHaveBeenCalledOnce())
    expect(scheduleTokenRefresh).toHaveBeenCalledOnce()

    unmount()

    expect(cleanup).toHaveBeenCalledOnce()
  })

  it("does not restore session before Zustand hydration is complete", async () => {
    const restoreSession = vi.fn().mockResolvedValue(undefined)
    const scheduleTokenRefresh = vi.fn()

    useAuthStore.setState({
      hasHydrated: false,
      restoreSession,
      scheduleTokenRefresh,
    } as Partial<ReturnType<typeof useAuthStore.getState>>)

    render(<SecurityInitializer />)

    await waitFor(() => expect(getCsrfToken).toHaveBeenCalledOnce())
    expect(restoreSession).not.toHaveBeenCalled()
    expect(scheduleTokenRefresh).not.toHaveBeenCalled()

    act(() => {
      useAuthStore.setState({ hasHydrated: true })
    })

    await waitFor(() => expect(restoreSession).toHaveBeenCalledOnce())
  })

  it("does not throw when CSRF prefetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.mocked(getCsrfToken).mockRejectedValue(new Error("offline"))

    render(<SecurityInitializer />)

    await waitFor(() => expect(warn).toHaveBeenCalledWith(
      "[Security] CSRF token initialization failed:",
      expect.any(Error),
    ))
  })
})
