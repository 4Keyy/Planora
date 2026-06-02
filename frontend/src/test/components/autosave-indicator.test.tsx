import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AutosaveIndicator } from "@/components/ui/autosave-indicator"

describe("AutosaveIndicator", () => {
  it("renders the resting label and exposes a polite live region", () => {
    render(<AutosaveIndicator status="idle" />)
    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(status).toHaveTextContent("Changes save automatically")
  })

  it("honours a custom idle label", () => {
    render(<AutosaveIndicator status="idle" idleLabel="Edits sync instantly" />)
    expect(screen.getByText("Edits sync instantly")).toBeInTheDocument()
  })

  it("announces saving, saved and error states", () => {
    const { rerender } = render(<AutosaveIndicator status="saving" />)
    expect(screen.getByText("Saving…")).toBeInTheDocument()

    rerender(<AutosaveIndicator status="saved" />)
    expect(screen.getByText("All changes saved")).toBeInTheDocument()

    rerender(<AutosaveIndicator status="error" />)
    expect(screen.getByText("Couldn’t save — will retry")).toBeInTheDocument()
  })
})
