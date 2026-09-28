import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { KeyRound } from "lucide-react"
import { AuthBanner, AuthCard, AuthMark } from "@/components/auth/auth-chrome"
import { PasswordInput } from "@/components/auth/password-input"
import { PasswordChecklist } from "@/components/auth/password-checklist"
import { PasswordsMatch } from "@/components/auth/passwords-match"
import { OneTimeCodeInput, normaliseCode } from "@/components/auth/one-time-code-input"
import { EmailSuggestion } from "@/components/auth/email-suggestion"
import { Wordmark, WORDMARK_ARC } from "@/components/ui/wordmark"
import { redactionArc } from "@/components/ui/redaction-badge"
import { useState } from "react"

describe("AuthBanner", () => {
  it("renders nothing when there is no message", () => {
    const { container } = render(<AuthBanner message={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("announces a refusal", () => {
    // The defect this guards: the banner was a bare motion.div, so the submit-time
    // refusal reached a screen reader only through a toast that then disappeared,
    // leaving nothing beside the form to come back to.
    render(<AuthBanner message="Incorrect email or password." />)
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect email or password.")
  })

  it("reports good news politely rather than as an alert", () => {
    render(<AuthBanner message="Sent again." tone="info" />)
    expect(screen.getByRole("status")).toHaveTextContent("Sent again.")
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("AuthCard", () => {
  it("makes the title the page's one h1 and keeps the mark out of the accessibility tree", () => {
    const { container } = render(
      <AuthCard mark={<AuthMark icon={KeyRound} />} title="Welcome back" lead="Sign in." footer={<p>Footer</p>}>
        <p>Body</p>
      </AuthCard>,
    )
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument()
    expect(screen.getByText("Sign in.")).toBeInTheDocument()
    expect(screen.getByText("Footer")).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
  })

  it("draws the product's check for a finished task", () => {
    const { container } = render(<AuthMark icon="check" />)
    expect(container.querySelector("path")).not.toBeNull()
  })
})

describe("Wordmark", () => {
  it("quotes the private ring exactly", () => {
    // Copied rather than imported (a client-module function is a client reference in a
    // server component); this keeps the copy honest.
    expect(WORDMARK_ARC).toEqual(redactionArc("private"))
  })

  it("names the product", () => {
    render(<Wordmark />)
    expect(screen.getByText("Planora")).toBeInTheDocument()
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
    // ancestor clips and any pointer-events:none wrapper disables.
    render(<PasswordInput aria-label="Password" />)
    const toggle = screen.getByRole("button", { name: "Show password" })
    expect(toggle.className).toContain("h-control")
    expect(toggle.className).toContain("w-control")
  })

  it("does not suppress the one focus indicator", () => {
    const { container } = render(<PasswordInput aria-label="Password" />)
    expect(container.innerHTML).not.toContain("outline-none")
  })

  it("warns about Caps Lock while typing, clears on blur, and still calls the caller's handlers", () => {
    const onBlur = vi.fn()
    const onKeyDown = vi.fn()
    const onCapsLockChange = vi.fn()
    render(
      <PasswordInput
        aria-label="Password"
        capsLockHint
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onCapsLockChange={onCapsLockChange}
      />,
    )
    const input = screen.getByLabelText("Password")

    fireEvent.keyDown(input, { key: "A", modifierCapsLock: true })
    expect(screen.getByRole("status")).toHaveTextContent("Caps Lock is on")
    expect(onKeyDown).toHaveBeenCalled()
    expect(onCapsLockChange).toHaveBeenLastCalledWith(true)

    fireEvent.blur(input)
    expect(screen.queryByText("Caps Lock is on")).toBeNull()
    // react-hook-form's `register` passes onBlur; dropping it would stop blur validation.
    expect(onBlur).toHaveBeenCalled()
    expect(onCapsLockChange).toHaveBeenLastCalledWith(false)
  })

  it("stays quiet about Caps Lock unless asked to", () => {
    render(<PasswordInput aria-label="Password" />)
    fireEvent.keyDown(screen.getByLabelText("Password"), { key: "A", modifierCapsLock: true })
    expect(screen.queryByText("Caps Lock is on")).toBeNull()
  })
})

describe("PasswordChecklist", () => {
  const states = () =>
    screen.getAllByRole("listitem").map((li) => [li.textContent?.replace(/ — (done|not yet)$/, ""), li.textContent?.endsWith("done")])

  it("marks each rule met or not yet, in words a screen reader reads", () => {
    render(<PasswordChecklist id="rules" value="abcdefgh1" />)
    expect(states()).toEqual([
      ["8 or more characters", true],
      ["An uppercase letter", false],
      ["A lowercase letter", true],
      ["A number", true],
      ["A symbol", false],
    ])
    expect(document.getElementById("rules")?.tagName).toBe("UL")
  })

  it("ticks everything for a password the server accepts", () => {
    render(<PasswordChecklist id="rules" value="Correct1!horse" />)
    expect(states().every(([, met]) => met)).toBe(true)
  })
})

describe("PasswordsMatch", () => {
  it("confirms only an exact, non-empty match", () => {
    const { rerender } = render(<PasswordsMatch password="Abc1!def" confirm="" />)
    expect(screen.queryByText("Passwords match")).toBeNull()
    rerender(<PasswordsMatch password="Abc1!def" confirm="Abc1!de" />)
    expect(screen.queryByText("Passwords match")).toBeNull()
    rerender(<PasswordsMatch password="Abc1!def" confirm="Abc1!def" />)
    expect(screen.getByText("Passwords match")).toBeInTheDocument()
  })
})

describe("OneTimeCodeInput", () => {
  function Harness({ onComplete }: { onComplete: (code: string) => void }) {
    const [value, setValue] = useState("")
    return <OneTimeCodeInput value={value} onChange={setValue} onComplete={onComplete} />
  }

  it("keeps digits only and accepts a pasted code with a space", () => {
    expect(normaliseCode("12a3 4-56789")).toBe("123456")
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    const input = screen.getByLabelText("6-digit code")
    fireEvent.change(input, { target: { value: "123 456" } })
    expect(input).toHaveValue("123456")
    expect(onComplete).toHaveBeenCalledWith("123456")
  })

  it("completes exactly once, on the sixth digit", async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    const input = screen.getByLabelText("6-digit code")
    await user.type(input, "12345")
    expect(onComplete).not.toHaveBeenCalled()
    await user.type(input, "6")
    expect(onComplete).toHaveBeenCalledTimes(1)
    await user.type(input, "7")
    expect(input).toHaveValue("123456")
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("is one real input the platform can fill", () => {
    render(<OneTimeCodeInput value="" onChange={() => {}} />)
    const input = screen.getByLabelText("6-digit code")
    expect(input).toHaveAttribute("autocomplete", "one-time-code")
    expect(input).toHaveAttribute("inputmode", "numeric")
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
  })
})

describe("EmailSuggestion", () => {
  it("offers the corrected address and hands it back", async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    render(<EmailSuggestion email="alex@gmial.com" onAccept={onAccept} />)
    await user.click(screen.getByRole("button", { name: "alex@gmail.com" }))
    expect(onAccept).toHaveBeenCalledWith("alex@gmail.com")
  })

  it("renders nothing for an address that looks right", () => {
    const { container } = render(<EmailSuggestion email="alex@gmail.com" onAccept={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
