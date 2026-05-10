import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LayoutWrapper } from "@/components/layout-wrapper"
import { PageBackground } from "@/components/page-background"
import { SecurityInitializer } from "@/components/security-initializer"
import { getCsrfToken } from "@/lib/csrf"
import { useAuthStore } from "@/store/auth"

vi.mock("@/components/faulty-terminal", () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="faulty-terminal" data-scale={String(props.scale)} />
  ),
}))

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

  it("renders the layout background terminal behind page content", () => {
    render(
      <LayoutWrapper>
        <main>Private content</main>
      </LayoutWrapper>,
    )

    expect(screen.getByTestId("faulty-terminal")).toHaveAttribute("data-scale", "2.9")
    expect(screen.getByText("Private content")).toBeInTheDocument()
  })

  it("wraps pages with a stable layered background", () => {
    render(
      <PageBackground>
        <section>Dashboard</section>
      </PageBackground>,
    )

    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByText("Dashboard").parentElement).toHaveClass("relative")
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
