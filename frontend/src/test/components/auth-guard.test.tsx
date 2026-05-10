import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthGuard } from "@/components/auth-guard"
import { useAuthStore } from "@/store/auth"

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerMocks.replace,
  }),
}))

const setAuthGuardState = (state: {
  hasHydrated: boolean
  hasRestoredSession: boolean
  isAuthenticated: boolean
}) => {
  useAuthStore.setState({
    hasHydrated: state.hasHydrated,
    hasRestoredSession: state.hasRestoredSession,
    isAuthenticated: state.isAuthenticated,
  })
}

describe("AuthGuard", () => {
  beforeEach(() => {
    routerMocks.replace.mockClear()
    setAuthGuardState({
      hasHydrated: false,
      hasRestoredSession: false,
      isAuthenticated: false,
    })
  })

  it("renders nothing while auth state is hydrating", () => {
    render(
      <AuthGuard>
        <div>Private page</div>
      </AuthGuard>,
    )

    expect(screen.queryByText("Private page")).not.toBeInTheDocument()
    expect(routerMocks.replace).not.toHaveBeenCalled()
  })

  it("redirects unauthenticated users after restoration completes", async () => {
    setAuthGuardState({
      hasHydrated: true,
      hasRestoredSession: true,
      isAuthenticated: false,
    })

    render(
      <AuthGuard>
        <div>Private page</div>
      </AuthGuard>,
    )

    expect(screen.queryByText("Private page")).not.toBeInTheDocument()
    await waitFor(() => expect(routerMocks.replace).toHaveBeenCalledWith("/auth/login"))
  })

  it("renders children for authenticated users", () => {
    setAuthGuardState({
      hasHydrated: true,
      hasRestoredSession: true,
      isAuthenticated: true,
    })

    render(
      <AuthGuard>
        <div>Private page</div>
      </AuthGuard>,
    )

    expect(screen.getByText("Private page")).toBeInTheDocument()
    expect(routerMocks.replace).not.toHaveBeenCalled()
  })
})
