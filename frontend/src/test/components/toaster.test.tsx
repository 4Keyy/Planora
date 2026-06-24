import { afterEach, describe, expect, it } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { Toaster } from "@/components/ui/toast"
import { useToastStore } from "@/store/toast"

describe("Toaster a11y", () => {
  afterEach(() => {
    act(() => useToastStore.setState({ toasts: [] }))
  })

  it("is a polite live region and announces errors assertively", () => {
    act(() => {
      useToastStore.getState().addToast({ type: "error", title: "Save failed" })
      useToastStore.getState().addToast({ type: "success", title: "Saved" })
    })

    render(<Toaster />)

    // The container is a labelled, polite live region.
    const region = screen.getByRole("region", { name: "Notifications" })
    expect(region).toHaveAttribute("aria-live", "polite")

    // Errors get role="alert" (assertive); other toasts get role="status".
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed")
    expect(screen.getByRole("status")).toHaveTextContent("Saved")
  })
})
