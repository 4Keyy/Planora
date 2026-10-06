import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, within } from "@testing-library/react"
import { AuthFrame, RecoverySteps, useRecoveryDone } from "@/components/auth/auth-frame"

const nav = vi.hoisted(() => ({ pathname: "/auth/login" }))
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }))

let markDone: (done: boolean) => void = () => {}
function Page() {
  markDone = useRecoveryDone()
  return <p>page</p>
}

const renderAt = (pathname: string) => {
  nav.pathname = pathname
  return render(
    <AuthFrame>
      <Page />
    </AuthFrame>,
  )
}

describe("AuthFrame", () => {
  beforeEach(() => {
    nav.pathname = "/auth/login"
  })

  it("links the wordmark home and gives the skip link its target", () => {
    const { container } = renderAt("/auth/login")
    expect(screen.getByRole("link", { name: "Planora home" })).toHaveAttribute("href", "/")
    expect(container.querySelector("main#main")).not.toBeNull()
    expect(screen.getByText("page")).toBeInTheDocument()
  })

  it("shows the recovery steps only on the recovery routes", () => {
    renderAt("/auth/login")
    expect(screen.queryByRole("navigation", { name: "Password reset" })).toBeNull()
  })

  it.each([
    ["/auth/forgot-password", "Email"],
    ["/auth/forgot-password/sent", "Inbox"],
    ["/auth/reset-password", "New password"],
  ])("marks %s as the %s step", (path, label) => {
    renderAt(path)
    const steps = screen.getByRole("navigation", { name: "Password reset" })
    const current = within(steps)
      .getAllByRole("listitem")
      .find((li) => li.getAttribute("aria-current") === "step")
    expect(current).toHaveTextContent(label)
  })

  it("moves the reset page to Done once the new password saved", () => {
    renderAt("/auth/reset-password")
    act(() => markDone(true))
    const steps = screen.getByRole("navigation", { name: "Password reset" })
    const current = within(steps)
      .getAllByRole("listitem")
      .find((li) => li.getAttribute("aria-current") === "step")
    expect(current).toHaveTextContent("Done")
    expect(within(steps).getAllByText("(done)")).toHaveLength(4)
  })
})

describe("RecoverySteps", () => {
  it("says which steps are behind you", () => {
    render(<RecoverySteps step={3} />)
    const items = screen.getAllByRole("listitem")
    expect(items.map((li) => li.textContent)).toEqual(["Email (done)", "Inbox (done)", "3New password", "4Done"])
    expect(items[2]).toHaveAttribute("aria-current", "step")
  })
})
