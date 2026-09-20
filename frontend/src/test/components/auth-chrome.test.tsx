import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AuthBanner, AuthBrand, AuthPanel } from "@/components/auth/auth-chrome"
import { PasswordInput } from "@/components/auth/password-input"

describe("AuthBanner", () => {
  it("renders nothing when there is no message", () => {
    const { container } = render(<AuthBanner message={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("announces the failure", () => {
    // The defect this guards: the banner was a bare motion.div, so the submit-time
    // refusal reached a screen reader only through a toast that then disappeared,
    // leaving nothing beside the form to come back to.
    render(<AuthBanner message="Incorrect email or password." />)
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect email or password.")
  })
})

describe("AuthPanel", () => {
  it("is hidden from assistive technology", () => {
    // It carries no action and nothing the form lacks. Without this a screen-reader
    // user on a desktop walks the whole marketing column before reaching the email field.
    const { container } = render(
      <AuthPanel>
        <p>Welcome back.</p>
      </AuthPanel>
    )
    const panel = container.firstElementChild
    expect(panel).toHaveAttribute("aria-hidden", "true")
  })
})

describe("AuthBrand", () => {
  it("names the product in the form column, at every breakpoint", () => {
    // The lockup used to be lg:hidden — the desktop got it from the panel. Now that the
    // panel is aria-hidden, that would leave a desktop screen-reader user with nothing
    // saying where they are.
    const { container } = render(<AuthBrand tagline="Real coordination for real life." />)
    expect(screen.getByText("Planora")).toBeInTheDocument()
    expect(container.querySelector(".lg\\:hidden")).toBeNull()
  })
})

describe("PasswordInput", () => {
  it("starts masked and toggles both the type and the label", async () => {
    const user = userEvent.setup()
    render(<PasswordInput aria-label="Password" />)

    const input = screen.getByLabelText("Password")
    expect(input).toHaveAttribute("type", "password")

    await user.click(screen.getByRole("button", { name: "Show password" }))
    expect(input).toHaveAttribute("type", "text")
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Hide password" }))
    expect(input).toHaveAttribute("type", "password")
  })

  it("gives the toggle a real 44px box rather than a painted hit area", () => {
    // `.touch-target` paints an invisible 44px pseudo-element, which any overflow:hidden
    // ancestor clips and any pointer-events:none wrapper disables — a control that
    // measures 44 to a probe and accepts no taps.
    render(<PasswordInput aria-label="Password" />)
    const toggle = screen.getByRole("button", { name: "Show password" })
    expect(toggle.className).toContain("h-control")
    expect(toggle.className).toContain("w-control")
  })

  it("does not suppress the one focus indicator", () => {
    // Tailwind compiles outline-none to a *transparent* outline, which beats the global
    // rule and leaves two pixels of nothing. Six auth routes shipped that way.
    const { container } = render(<PasswordInput aria-label="Password" />)
    expect(container.innerHTML).not.toContain("outline-none")
  })
})
