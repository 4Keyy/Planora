import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { Field, FIELD_LABEL_CLASS } from "@/components/ui/field"

/**
 * These assertions are about ASSOCIATIONS, not appearance. Every one of them was
 * broken in at least one of the four hand-rolled field wrappers this primitive
 * replaced, and none of the breakages was visible on screen.
 */

describe("Field", () => {
  it("associates the label with the control", async () => {
    render(<Field label="Email">{(f) => <input {...f} />}</Field>)
    const input = screen.getByLabelText("Email")
    // Clicking the label must move focus into the control.
    await userEvent.click(screen.getByText("Email"))
    expect(input).toHaveFocus()
  })

  it("gives each field a distinct id", () => {
    render(
      <>
        <Field label="First name">{(f) => <input {...f} />}</Field>
        <Field label="Last name">{(f) => <input {...f} />}</Field>
      </>
    )
    const a = screen.getByLabelText("First name")
    const b = screen.getByLabelText("Last name")
    expect(a.id).toBeTruthy()
    expect(a.id).not.toBe(b.id)
  })

  it("describes the control with the error rather than naming it", () => {
    // The old wrapper put the error inside the <label>, so a screen reader
    // announced "Email Passwords don't match" as the field's NAME.
    render(
      <Field label="Email" error="Passwords don't match">
        {(f) => <input {...f} />}
      </Field>
    )
    const input = screen.getByLabelText("Email")
    expect(input).toHaveAccessibleName("Email")
    expect(input).toHaveAccessibleDescription("Passwords don't match")
  })

  it("marks the control invalid, not just red", () => {
    // A red border communicates nothing to assistive tech; aria-invalid does.
    const { rerender } = render(
      <Field label="Email" error="Required">{(f) => <input {...f} />}</Field>
    )
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true")

    rerender(<Field label="Email">{(f) => <input {...f} />}</Field>)
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid")
  })

  it("announces the error, because it appears after a submit the user already made", () => {
    render(<Field label="Email" error="Required">{(f) => <input {...f} />}</Field>)
    expect(screen.getByRole("alert")).toHaveTextContent("Required")
  })

  it("describes the control with a hint when there is no error", () => {
    render(
      <Field label="2FA Code" hint="Six digits from your authenticator app.">
        {(f) => <input {...f} />}
      </Field>
    )
    expect(screen.getByLabelText("2FA Code")).toHaveAccessibleDescription(
      "Six digits from your authenticator app."
    )
  })

  it("reads the error before the hint when both are present", () => {
    render(
      <Field label="Password" hint="At least 6 characters." error="Too short">
        {(f) => <input {...f} />}
      </Field>
    )
    // Order is the order a screen reader speaks them, and the error is the more urgent.
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Too short At least 6 characters.")
  })

  it("marks a required field on the control, not only with an asterisk", () => {
    render(<Field label="Name" required>{(f) => <input {...f} />}</Field>)
    expect(screen.getByLabelText(/Name/)).toBeRequired()
  })

  it("hides the decorative asterisk from assistive tech", () => {
    // The control's own `required` already carries the meaning; a spoken "star"
    // in the middle of the field name does not.
    render(<Field label="Name" required>{(f) => <input {...f} />}</Field>)
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true")
  })

  it("keeps a visually hidden label in the accessibility tree", () => {
    render(<Field label="Search" labelHidden>{(f) => <input {...f} />}</Field>)
    expect(screen.getByLabelText("Search")).toBeInTheDocument()
    expect(screen.getByText("Search")).toHaveClass("sr-only")
  })

  it("passes no describedby when there is nothing to describe", () => {
    render(<Field label="Email">{(f) => <input {...f} />}</Field>)
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-describedby")
  })

  it("exports one label class for the whole product", () => {
    render(<Field label="Email">{(f) => <input {...f} />}</Field>)
    for (const cls of FIELD_LABEL_CLASS.split(" ")) {
      expect(screen.getByText("Email")).toHaveClass(cls)
    }
  })
})
