import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LoginPage from "@/app/auth/login/page"
import RegisterPage from "@/app/auth/register/page"
import ForgotPasswordPage from "@/app/auth/forgot-password/page"
import ResetLinkSentPage from "@/app/auth/forgot-password/sent/page"
import ResetPasswordPage from "@/app/auth/reset-password/page"
import VerifyEmailPage from "@/app/auth/verify-email/page"
import { api } from "@/lib/api"
import { RESET_EMAIL_KEY, RESET_SENT_AT_KEY } from "@/lib/auth-flow"
import { useAuthStore } from "@/store/auth"

/**
 * The five auth screens, by behaviour: what each one sends, and where each refusal lands.
 * `src/app/**` is outside the coverage gate, so these guard the pages themselves.
 */

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.params,
  usePathname: () => "/auth/login",
}))

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

vi.mock("@/lib/api", () => ({
  api: { post: vi.fn(), get: vi.fn() },
  parseApiResponse: (data: unknown) => data,
}))

vi.mock("@/lib/auth-public", () => ({
  refreshAccessToken: vi.fn().mockRejectedValue(new Error("signed out")),
}))

const post = vi.mocked(api.post)
const get = vi.mocked(api.get)

const LOGIN_OK = {
  data: {
    userId: "u1",
    email: "alex@example.com",
    firstName: "Alex",
    lastName: "Morgan",
    accessToken: "token",
    expiresAt: "2099-01-01T00:00:00Z",
  },
}
const twoFactor = (message = "Two-factor authentication code is required") => ({
  response: { status: 401, data: { error: message } },
})

beforeEach(() => {
  post.mockReset()
  get.mockReset()
  nav.push.mockReset()
  nav.replace.mockReset()
  nav.params = new URLSearchParams()
  sessionStorage.clear()
  useAuthStore.setState({ hasHydrated: true, hasRestoredSession: true, isAuthenticated: false })
})

async function fillSignIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "alex@example.com")
  await user.type(screen.getByLabelText("Password"), "Correct1!horse")
}

describe("sign in", () => {
  it("renders the form without waiting for the session restore", () => {
    useAuthStore.setState({ hasHydrated: false, hasRestoredSession: false })
    render(<LoginPage />)
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument()
  })

  it("sends a signed-in visitor to the dashboard", () => {
    useAuthStore.setState({ isAuthenticated: true })
    render(<LoginPage />)
    expect(nav.replace).toHaveBeenCalledWith("/dashboard")
  })

  it("signs in and keeps the session for 30 days when asked", async () => {
    const user = userEvent.setup()
    post.mockResolvedValueOnce(LOGIN_OK)
    render(<LoginPage />)
    await fillSignIn(user)
    await user.click(screen.getByLabelText("Keep me signed in for 30 days"))
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/dashboard"))
    expect(post).toHaveBeenCalledWith("/auth/api/v1/auth/login", {
      email: "alex@example.com",
      password: "Correct1!horse",
      rememberMe: true,
      twoFactorCode: undefined,
    })
  })

  it("asks for a password without judging its shape", async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText("Email"), "alex@example.com")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    expect(await screen.findByText("Enter your password")).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it("puts a refused sign-in in one announced banner", async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce({ response: { status: 401, data: { error: "Invalid email or password" } } })
    render(<LoginPage />)
    await fillSignIn(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password don't match")
  })

  it("offers the fix for a mistyped email domain", async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText("Email"), "alex@gmial.com")
    await user.tab()
    await user.click(await screen.findByRole("button", { name: "alex@gmail.com" }))
    expect(screen.getByLabelText("Email")).toHaveValue("alex@gmail.com")
  })

  it("moves to six code cells when the server asks, and submits on the sixth digit", async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce(twoFactor()).mockResolvedValueOnce(LOGIN_OK)
    render(<LoginPage />)
    await fillSignIn(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByRole("heading", { name: "Two-step sign-in" })).toBeInTheDocument()
    const code = screen.getByLabelText("6-digit code")
    fireEvent.change(code, { target: { value: "123 456" } })

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/dashboard"))
    expect(post).toHaveBeenLastCalledWith(
      "/auth/api/v1/auth/login",
      expect.objectContaining({ email: "alex@example.com", twoFactorCode: "123456" }),
    )
  })

  it("puts a wrong code under the cells and empties them", async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce(twoFactor()).mockRejectedValueOnce(twoFactor("Invalid two-factor authentication code"))
    render(<LoginPage />)
    await fillSignIn(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    fireEvent.change(await screen.findByLabelText("6-digit code"), { target: { value: "000000" } })

    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't match")
    expect(screen.getByLabelText("6-digit code")).toHaveValue("")
  })

  it("takes a recovery code instead, and goes back to the password", async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce(twoFactor()).mockResolvedValueOnce(LOGIN_OK)
    render(<LoginPage />)
    await fillSignIn(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    await user.click(await screen.findByRole("button", { name: "Use a recovery code instead" }))
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }))
    expect(await screen.findByText("Enter one of your recovery codes.")).toBeInTheDocument()

    await user.type(screen.getByLabelText("Recovery code"), "ABCD-EFGH")
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }))
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(
        "/auth/api/v1/auth/login",
        expect.objectContaining({ twoFactorCode: "ABCD-EFGH" }),
      ),
    )
  })

  it("returns to the password stage with Back", async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce(twoFactor())
    render(<LoginPage />)
    await fillSignIn(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await user.click(await screen.findByRole("button", { name: "Back" }))
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("alex@example.com"))
  })
})

describe("create account", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, confirm = "Correct1!horse") {
    await user.type(screen.getByLabelText("First name"), "Alex")
    await user.type(screen.getByLabelText("Last name"), "Morgan")
    await user.type(screen.getByLabelText("Email"), "alex@example.com")
    await user.type(screen.getByLabelText("Password"), "Correct1!horse")
    await user.type(screen.getByLabelText("Confirm password"), confirm)
  }

  it("ticks the rules and confirms the match while typing, then posts the server-required confirmation", async () => {
    const user = userEvent.setup()
    post.mockResolvedValueOnce(LOGIN_OK)
    render(<RegisterPage />)
    await fill(user)
    expect(screen.getAllByText(/— done/)).toHaveLength(5)
    expect(screen.getByText("Passwords match")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Create account" }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/dashboard"))
    expect(post).toHaveBeenCalledWith("/auth/api/v1/auth/register", {
      firstName: "Alex",
      lastName: "Morgan",
      email: "alex@example.com",
      password: "Correct1!horse",
      confirmPassword: "Correct1!horse",
    })
    expect(sessionStorage.getItem("planora-first-run")).toBe("1")
  })

  it("says the two passwords differ on submit", async () => {
    const user = userEvent.setup()
    render(<RegisterPage />)
    await fill(user, "Correct1!horsf")
    await user.click(screen.getByRole("button", { name: "Create account" }))
    expect(await screen.findByText("The two passwords don't match.")).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it("puts a taken address on the email field", async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce({ response: { status: 409 } })
    render(<RegisterPage />)
    await fill(user)
    await user.click(screen.getByRole("button", { name: "Create account" }))
    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true")
  })
})

describe("password recovery", () => {
  it("sends the link and moves to the inbox step, carrying the address", async () => {
    const user = userEvent.setup()
    post.mockResolvedValueOnce({ data: {} })
    render(<ForgotPasswordPage />)
    await user.type(screen.getByLabelText("Email"), "alex@example.com")
    await user.click(screen.getByRole("button", { name: "Send the link" }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/auth/forgot-password/sent"))
    expect(sessionStorage.getItem(RESET_EMAIL_KEY)).toBe("alex@example.com")
    expect(Number(sessionStorage.getItem(RESET_SENT_AT_KEY))).toBeGreaterThan(0)
  })

  it("comes back with the address filled in", async () => {
    sessionStorage.setItem(RESET_EMAIL_KEY, "alex@example.com")
    render(<ForgotPasswordPage />)
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("alex@example.com"))
  })

  it("explains a rate limit in the banner", async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce({ response: { status: 429 } })
    render(<ForgotPasswordPage />)
    await user.type(screen.getByLabelText("Email"), "alex@example.com")
    await user.click(screen.getByRole("button", { name: "Send the link" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests")
  })

  it("names the address masked and holds the resend for a minute", async () => {
    sessionStorage.setItem(RESET_EMAIL_KEY, "alex.morgan@gmail.com")
    sessionStorage.setItem(RESET_SENT_AT_KEY, String(Date.now()))
    render(<ResetLinkSentPage />)
    expect(await screen.findByText("a•••n@gmail.com")).toBeInTheDocument()
    const resend = await screen.findByRole("button", { name: /Send again in/ })
    expect(resend).toBeDisabled()
  })

  it("sends it again once the cooldown is over", async () => {
    const user = userEvent.setup()
    post.mockResolvedValueOnce({ data: {} })
    sessionStorage.setItem(RESET_EMAIL_KEY, "alex@example.com")
    sessionStorage.setItem(RESET_SENT_AT_KEY, String(Date.now() - 120_000))
    render(<ResetLinkSentPage />)
    await user.click(await screen.findByRole("button", { name: "Send it again" }))
    expect(await screen.findByRole("status")).toHaveTextContent("Sent again")
    expect(post).toHaveBeenCalledWith("/auth/api/v1/auth/request-password-reset", { email: "alex@example.com" })
  })

  it("does without the address after a direct visit", async () => {
    render(<ResetLinkSentPage />)
    expect(await screen.findByText(/If that address has an account/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull()
    expect(screen.getByRole("link", { name: "Enter your email" })).toHaveAttribute("href", "/auth/forgot-password")
  })
})

describe("choosing a new password", () => {
  async function fillReset(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("New password"), "Correct1!horse")
    await user.type(screen.getByLabelText("Confirm new password"), "Correct1!horse")
    await user.click(screen.getByRole("button", { name: "Save new password" }))
  }

  it("asks for the link when there is no token", () => {
    render(<ResetPasswordPage />)
    expect(screen.getByRole("heading", { level: 1, name: "Open the link from your email" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/auth/forgot-password")
  })

  it("saves with the token from the link and ends on Password changed", async () => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams("token=abc")
    sessionStorage.setItem(RESET_EMAIL_KEY, "alex@example.com")
    post.mockResolvedValueOnce({ data: {} })
    render(<ResetPasswordPage />)
    await fillReset(user)
    expect(await screen.findByRole("heading", { name: "Password changed" })).toBeInTheDocument()
    expect(post).toHaveBeenCalledWith("/auth/api/v1/auth/reset-password", {
      resetToken: "abc",
      newPassword: "Correct1!horse",
      confirmPassword: "Correct1!horse",
    })
    expect(sessionStorage.getItem(RESET_EMAIL_KEY)).toBeNull()
  })

  it("puts a breached password on the password field, not on the link", async () => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams("token=abc")
    post.mockRejectedValueOnce({ response: { status: 400, data: { code: "COMPROMISED_PASSWORD" } } })
    render(<ResetPasswordPage />)
    await fillReset(user)
    expect(await screen.findByText(/appeared in a data breach/)).toBeInTheDocument()
    expect(screen.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true")
  })

  it("replaces the form when the link is dead", async () => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams("resetToken=abc")
    post.mockRejectedValueOnce({ response: { status: 400, data: { code: "INVALID_TOKEN" } } })
    render(<ResetPasswordPage />)
    await fillReset(user)
    expect(await screen.findByRole("heading", { name: "This link has expired or was already used" })).toBeInTheDocument()
  })
})

describe("verifying an email", () => {
  it("checks the link once and confirms it", async () => {
    nav.params = new URLSearchParams("token=t1")
    get.mockResolvedValueOnce({ data: {} })
    render(<VerifyEmailPage />)
    expect(await screen.findByRole("heading", { name: "Email verified" })).toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login")
  })

  it("offers a new link to a signed-in visitor whose link failed", async () => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams("token=t1")
    useAuthStore.setState({ isAuthenticated: true })
    get.mockRejectedValueOnce({ response: { status: 400 } })
    post.mockResolvedValueOnce({ data: {} })
    render(<VerifyEmailPage />)
    expect(await screen.findByRole("heading", { name: "This link didn't work" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Send a new link" }))
    expect(await screen.findByRole("heading", { name: "New link sent" })).toBeInTheDocument()
    expect(post).toHaveBeenCalledWith("/auth/api/v1/users/me/verify-email", {})
  })

  it("lets a network failure be retried", async () => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams("token=t1")
    get.mockRejectedValueOnce({ request: {}, code: "ERR_NETWORK" }).mockResolvedValueOnce({ data: {} })
    render(<VerifyEmailPage />)
    await user.click(await screen.findByRole("button", { name: "Try again" }))
    expect(await screen.findByRole("heading", { name: "Email verified" })).toBeInTheDocument()
  })

  it("sends a signed-out visitor without a token to sign in", async () => {
    render(<VerifyEmailPage />)
    await act(async () => {})
    expect(screen.getByRole("heading", { name: "Open the link from your email" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login")
  })
})
