import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const authPublic = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  validateAccessToken: vi.fn(),
}))
vi.mock("@/lib/auth-public", () => authPublic)
vi.mock("next/navigation", () => ({ usePathname: () => "/" }))

import { DemoSandbox } from "@/app/_landing/demo-sandbox"
import { api } from "@/lib/api"
import { disableDemo, isDemoInstalled } from "@/lib/demo/enable"
import { DEMO_USER } from "@/lib/demo/state"
import { useAuthStore } from "@/store/auth"

/**
 * The sandbox gate.
 *
 * It used to install on mount, racing `restoreSession()`: an anonymous visitor's failed
 * refresh wiped the seeded session and broadcast a logout to other tabs, the seeded token
 * could be POSTed to the real server for validation, and a signed-in visitor's real
 * session was overwritten on the way in and erased on the way out. These pin the three
 * states the gate now has, and that nothing it does reaches the network.
 */

const REAL_USER = { userId: "real-user", email: "real@example.com", firstName: "Real", lastName: "User" }

function setRestore(state: { hasHydrated: boolean; hasRestoredSession: boolean }) {
  act(() => useAuthStore.setState(state))
}

const renderGate = () =>
  render(
    <DemoSandbox placeholder={<p>placeholder</p>}>
      <p>console</p>
    </DemoSandbox>,
  )

beforeEach(() => {
  disableDemo()
  authPublic.refreshAccessToken.mockReset()
  authPublic.validateAccessToken.mockReset()
  useAuthStore.setState({
    isAuthenticated: false,
    accessToken: undefined,
    user: undefined,
    hasHydrated: false,
    hasRestoredSession: false,
  })
})

afterEach(() => disableDemo())

describe("DemoSandbox", () => {
  it("holds the placeholder and installs nothing until the restore has finished", () => {
    const original = api.defaults.adapter
    renderGate()
    expect(screen.getByText("placeholder")).toBeInTheDocument()
    expect(isDemoInstalled()).toBe(false)
    expect(api.defaults.adapter).toBe(original)

    // Hydrated is not enough: the restore is what used to race the seed.
    setRestore({ hasHydrated: true, hasRestoredSession: false })
    expect(isDemoInstalled()).toBe(false)
    expect(screen.getByText("placeholder")).toBeInTheDocument()
  })

  it("installs for an anonymous visitor once restored", () => {
    renderGate()
    setRestore({ hasHydrated: true, hasRestoredSession: true })
    expect(isDemoInstalled()).toBe(true)
    expect(screen.getByText("console")).toBeInTheDocument()
    expect(useAuthStore.getState().user?.userId).toBe(DEMO_USER.userId)
  })

  it("leaves a signed-in visitor's real session alone and points at their own list", () => {
    const original = api.defaults.adapter
    act(() =>
      useAuthStore.setState({ isAuthenticated: true, accessToken: "real-token", user: REAL_USER }),
    )
    renderGate()
    setRestore({ hasHydrated: true, hasRestoredSession: true })

    expect(isDemoInstalled()).toBe(false)
    expect(api.defaults.adapter).toBe(original)
    expect(useAuthStore.getState().accessToken).toBe("real-token")
    expect(useAuthStore.getState().user?.userId).toBe("real-user")
    expect(screen.queryByText("console")).not.toBeInTheDocument()
    expect(screen.getByText("You're signed in")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open my tasks" })).toHaveAttribute("href", "/tasks")
  })

  it("uninstalls on unmount and forgets the persisted demo identity", () => {
    const { unmount } = renderGate()
    setRestore({ hasHydrated: true, hasRestoredSession: true })
    expect(isDemoInstalled()).toBe(true)

    unmount()
    expect(isDemoInstalled()).toBe(false)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    const persisted = window.sessionStorage.getItem("planora-auth")
    expect(persisted === null || !persisted.includes(DEMO_USER.userId)).toBe(true)
  })

  it("never reaches the auth endpoints, which the adapter swap does not cover", () => {
    renderGate()
    setRestore({ hasHydrated: true, hasRestoredSession: true })
    expect(authPublic.validateAccessToken).not.toHaveBeenCalled()
    expect(authPublic.refreshAccessToken).not.toHaveBeenCalled()
  })

  it("re-seeds silently when a logout from another tab clears the session", () => {
    const post = vi.fn()
    const Channel = globalThis.BroadcastChannel
    // Any broadcast from the re-seed would go through here.
    globalThis.BroadcastChannel = class {
      postMessage = post
      close() {}
    } as unknown as typeof BroadcastChannel

    renderGate()
    setRestore({ hasHydrated: true, hasRestoredSession: true })
    act(() => useAuthStore.getState().clearAuth(true))

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().user?.userId).toBe(DEMO_USER.userId)
    expect(post).not.toHaveBeenCalled()
    globalThis.BroadcastChannel = Channel
  })
})
