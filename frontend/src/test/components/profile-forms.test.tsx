import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ChangePasswordForm } from "@/components/profile/change-password-form"
import { ChangeEmailForm } from "@/components/profile/change-email-form"
import { api } from "@/lib/api"

vi.mock("@/lib/api", () => ({ api: { post: vi.fn() } }))
const post = vi.mocked(api.post)

const refusal = (code: string) => ({ response: { status: 400, data: { code } } })

beforeEach(() => post.mockReset())

describe("ChangePasswordForm", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, next = "Correct1!horse", confirm = next) {
    await user.type(screen.getByLabelText("Current password"), "Old1!password")
    await user.type(screen.getByLabelText("New password"), next)
    await user.type(screen.getByLabelText("Confirm new password"), confirm)
    await user.click(screen.getByRole("button", { name: "Change password" }))
  }

  it("labels every field and changes the password", async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    post.mockResolvedValueOnce({ data: {} })
    render(<ChangePasswordForm onChanged={onChanged} />)
    await fill(user)
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(post).toHaveBeenCalledWith("/auth/api/v1/users/me/change-password", {
      currentPassword: "Old1!password",
      newPassword: "Correct1!horse",
      confirmNewPassword: "Correct1!horse",
    })
    expect(screen.getByLabelText("Current password")).toHaveValue("")
  })

  it("checks the new password the way the server will before sending it", async () => {
    const user = userEvent.setup()
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    await fill(user, "Abcd1234!")
    expect(await screen.findByText(/Too easy to guess/)).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it("says when the two new passwords differ", async () => {
    const user = userEvent.setup()
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    await fill(user, "Correct1!horse", "Correct1!horsf")
    expect(await screen.findByText("The two passwords don't match.")).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it.each([
    ["INVALID_PASSWORD", "Current password", /isn't your current password/],
    ["COMPROMISED_PASSWORD", "New password", /appeared in a data breach/],
    ["PASSWORD_REUSED", "New password", /used this password before/],
  ])("puts %s on the field it is about", async (code, label, message) => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce(refusal(code))
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    await fill(user)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true")
  })

  it("puts a network failure in the banner", async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce({ request: {}, code: "ERR_NETWORK" })
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    await fill(user)
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach Planora")
  })
})

describe("ChangeEmailForm", () => {
  const props = { currentEmail: "alex@example.com", verified: true, onResend: vi.fn(), resending: false }

  it("changes the email and hands the new address back", async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    post.mockResolvedValueOnce({ data: {} })
    render(<ChangeEmailForm {...props} onChanged={onChanged} />)
    await user.type(screen.getByLabelText("New email"), "alex@new.example")
    await user.type(screen.getByLabelText("Password"), "Old1!password")
    await user.click(screen.getByRole("button", { name: "Change email" }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("alex@new.example"))
    expect(post).toHaveBeenCalledWith("/auth/api/v1/users/me/change-email", {
      newEmail: "alex@new.example",
      password: "Old1!password",
    })
  })

  it("refuses the current address and a missing password without a round trip", async () => {
    const user = userEvent.setup()
    render(<ChangeEmailForm {...props} onChanged={vi.fn()} />)
    await user.type(screen.getByLabelText("New email"), "ALEX@example.com")
    await user.click(screen.getByRole("button", { name: "Change email" }))
    expect(await screen.findByText("That is already your email")).toBeInTheDocument()
    expect(screen.getByText("Enter your password to confirm")).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it("puts a taken address on the address field", async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce({ response: { status: 400, data: { error: { code: "EMAIL_EXISTS" } } } })
    render(<ChangeEmailForm {...props} onChanged={vi.fn()} />)
    await user.type(screen.getByLabelText("New email"), "taken@example.com")
    await user.type(screen.getByLabelText("Password"), "Old1!password")
    await user.click(screen.getByRole("button", { name: "Change email" }))
    expect(await screen.findByText("Another account already uses this address.")).toBeInTheDocument()
  })

  it("offers to send the verification link again only while unverified", async () => {
    const user = userEvent.setup()
    const onResend = vi.fn()
    const { rerender } = render(<ChangeEmailForm {...props} onChanged={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Send link again" })).toBeNull()
    rerender(<ChangeEmailForm {...props} verified={false} onResend={onResend} onChanged={vi.fn()} />)
    await user.click(screen.getByRole("button", { name: "Send link again" }))
    expect(onResend).toHaveBeenCalledOnce()
  })
})
