import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { RealtimeManager } from "@/components/realtime-manager"
import { useAuthStore } from "@/store/auth"

describe("RealtimeManager", () => {
  it("renders headlessly and stays idle while signed out", () => {
    // Signed out → both lifecycle hooks take their no-op branches (no socket, no fetch).
    useAuthStore.setState({ isAuthenticated: false, accessToken: undefined })
    const { container } = render(<RealtimeManager />)
    expect(container.firstChild).toBeNull()
  })
})
