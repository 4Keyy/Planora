import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ProfilePage from "@/app/(app)/profile/page"
import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import type { FriendDto, FriendRequestDto, SessionDto, UserDto } from "@/types/auth"

// The profile's account and friendship actions, through the real page: each one sends one request
// to the Auth API and says how it went. Without IntersectionObserver (jsdom) every section loads at
// once, which is the page's documented fallback.
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  parseApiResponse: (data: unknown) => data,
  getApiErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
}))
vi.mock("@/lib/auth-public", () => ({ refreshAccessToken: vi.fn().mockRejectedValue(new Error("signed out")) }))

const me: UserDto = {
  id: "user-1", email: "alex@example.com", firstName: "Alex", lastName: "Morgan",
  isEmailVerified: false, status: "Active", twoFactorEnabled: false, createdAt: "2026-01-01T00:00:00Z",
}
const sessions: SessionDto[] = [
  { id: "s-here", deviceName: "Laptop", browser: "Firefox", ipAddress: "10.0.0.1", location: "Moscow", isCurrent: true, createdAt: "2026-10-26T08:00:00Z", expiresAt: "2026-11-26T08:00:00Z" },
  { id: "s-phone", deviceName: "Phone", browser: "Safari", ipAddress: "10.0.0.2", location: "Kazan", isCurrent: false, createdAt: "2026-10-20T08:00:00Z", expiresAt: "2026-11-20T08:00:00Z" },
]
const request: FriendRequestDto = {
  friendshipId: "fr-1", userId: "user-ada", email: "ada@example.com", firstName: "Ada", lastName: "Lovelace",
  requestedAt: "2026-10-25T08:00:00Z", status: "Pending",
}
const friend: FriendDto = {
  id: "user-grace", email: "grace@example.com", firstName: "Grace", lastName: "Hopper", profilePictureUrl: null, friendsSince: "2026-09-01T00:00:00Z",
}

let twoFactorEnabled = false

beforeEach(() => {
  twoFactorEnabled = false
  router.push.mockReset()
  useToastStore.getState().clear()
  useAuthStore.setState({
    isAuthenticated: true, hasHydrated: true, hasRestoredSession: true,
    roles: ["User"], isTokenValid: () => true,
    user: { userId: me.id, email: me.email, firstName: me.firstName, lastName: me.lastName },
  })
  vi.mocked(api.get).mockReset().mockImplementation(async (url, config) => {
    if (url === "/auth/api/v1/users/me") return { data: { ...me, twoFactorEnabled } }
    if (url === "/auth/api/v1/users/me/security") return { data: { activeSessionsCount: 2, failedLoginAttempts: 0, twoFactorEnabled } }
    if (url === "/auth/api/v1/users/me/sessions") return { data: sessions }
    if (url === "/friendships/requests") return { data: (config?.params as { incoming?: boolean })?.incoming ? [request] : [] }
    if (url === "/friendships") return { data: { items: [friend], totalCount: 1, pageNumber: 1, pageSize: 10 } }
    return { data: { items: [], totalCount: 0, pageNumber: 1, pageSize: 10 } }
  })
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} })
  vi.mocked(api.delete).mockReset().mockResolvedValue({ data: {} })
  vi.mocked(api.put).mockReset().mockResolvedValue({ data: me })
})

afterEach(() => useToastStore.getState().clear())

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title)

async function renderProfile() {
  render(<ProfilePage />)
  await waitFor(() => expect(screen.getByLabelText("First name")).toHaveValue("Alex"))
}

describe("Profile account actions", () => {
  it("sends a verification email for an unverified address", async () => {
    const user = userEvent.setup()
    await renderProfile()

    await user.click(await screen.findByRole("button", { name: "Send link again" }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/api/v1/users/me/verify-email", {}))
    expect(toastTitles()).toContain("Verification email sent")
  })

  it("sets up two-factor: the key, then a code to confirm it", async () => {
    const user = userEvent.setup()
    vi.mocked(api.post).mockImplementation(async (url) =>
      url.endsWith("/2fa/enable") ? { data: { secret: "JBSWY3DPEHPK3PXP", qrCodeUrl: "otpauth://totp/Planora" } } : { data: {} })
    await renderProfile()

    await user.click(screen.getByRole("button", { name: "Enable two-factor" }))
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument()
    expect(toastTitles()).toContain("2FA setup generated")

    twoFactorEnabled = true
    await user.type(screen.getByLabelText("Six-digit verification code"), "123456")
    await user.click(screen.getByRole("button", { name: "Enable two-factor" }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/api/v1/users/me/2fa/confirm", { code: "123456" }))
    expect(toastTitles()).toContain("2FA enabled")
  })

  it("says the code was wrong when the server refuses it", async () => {
    const user = userEvent.setup()
    vi.mocked(api.post).mockImplementation(async (url) => {
      if (url.endsWith("/2fa/enable")) return { data: { secret: "JBSWY3DPEHPK3PXP", qrCodeUrl: "otpauth://totp/Planora" } }
      throw new Error("Invalid code")
    })
    await renderProfile()

    await user.click(screen.getByRole("button", { name: "Enable two-factor" }))
    await user.type(await screen.findByLabelText("Six-digit verification code"), "000000")
    await user.click(screen.getByRole("button", { name: "Enable two-factor" }))

    await waitFor(() => expect(toastTitles()).toContain("Invalid 2FA code"))
  })

  it("turns two-factor off only with the password", async () => {
    const user = userEvent.setup()
    twoFactorEnabled = true
    await renderProfile()

    const password = await screen.findByLabelText("Your password, to turn off two-factor")
    await user.click(screen.getByRole("button", { name: "Disable" }))
    expect(api.post).not.toHaveBeenCalledWith("/auth/api/v1/users/me/2fa/disable", expect.anything())

    await user.type(password, "Correct1!horse")
    await user.click(screen.getByRole("button", { name: "Disable" }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/api/v1/users/me/2fa/disable", { password: "Correct1!horse" }))
    expect(toastTitles()).toContain("2FA disabled")
  })

  it("revokes another session, and not the current one", async () => {
    const user = userEvent.setup()
    await renderProfile()

    const phone = (await screen.findByText(/Phone · Safari/)).closest("li")!
    await user.click(within(phone).getByRole("button", { name: "Revoke" }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/auth/api/v1/users/me/sessions/s-phone"))
    expect(toastTitles()).toContain("Session revoked")
    const here = screen.getByText(/Laptop · Firefox/).closest("li")!
    expect(within(here).queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument()
  })

  it("signs out every other session with the password, and says so when it fails", async () => {
    const user = userEvent.setup()
    vi.mocked(api.post).mockImplementation(async (url) => {
      if (url.endsWith("/revoke-all")) throw new Error("Wrong password")
      return { data: {} }
    })
    await renderProfile()

    await user.type(screen.getByLabelText("Your password, to sign out other sessions"), "Wrong1!pass")
    await user.click(screen.getByRole("button", { name: "Revoke all" }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/api/v1/users/me/sessions/revoke-all", { password: "Wrong1!pass" }))
    await waitFor(() => expect(toastTitles()).toContain("Couldn't revoke sessions"))
  })

  it("deletes the account with the password, signs out and goes to sign-in", async () => {
    const user = userEvent.setup()
    await renderProfile()

    await user.click(screen.getByRole("button", { name: "Delete" }))
    expect(api.delete).not.toHaveBeenCalledWith("/auth/api/v1/users/me", expect.anything())

    await user.type(screen.getByLabelText("Your password, to delete your account"), "Correct1!horse")
    await user.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/auth/api/v1/users/me", { data: { password: "Correct1!horse" } }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/auth/login"))
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it("keeps the account and says so when deletion fails", async () => {
    const user = userEvent.setup()
    vi.mocked(api.delete).mockRejectedValue(new Error("Wrong password"))
    await renderProfile()

    await user.type(screen.getByLabelText("Your password, to delete your account"), "Wrong1!pass")
    await user.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(toastTitles()).toContain("Couldn't delete account"))
    expect(router.push).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})

describe("Profile friendship actions", () => {
  it("invites a friend by email, lower-cased and trimmed", async () => {
    const user = userEvent.setup()
    await renderProfile()

    await user.type(screen.getByPlaceholderText("friend@planora.app"), "  Ada@Example.COM ")
    await user.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/api/v1/friendships/requests/by-email", { email: "ada@example.com" }))
    expect(toastTitles()).toContain("Invite sent")
  })

  it("refuses an address that is not an email before sending", async () => {
    const user = userEvent.setup()
    await renderProfile()

    await user.type(screen.getByPlaceholderText("friend@planora.app"), "ada.example.com")
    await user.click(screen.getByRole("button", { name: "Send" }))

    expect(toastTitles()).toContain("Invalid email")
    expect(api.post).not.toHaveBeenCalledWith("/auth/api/v1/friendships/requests/by-email", expect.anything())
  })

  it("sends a request by user ID, and refuses one that is not an ID", async () => {
    const user = userEvent.setup()
    await renderProfile()
    const id = screen.getByPlaceholderText("00000000-0000-0000-0000-000000000000")

    await user.type(id, "not-an-id")
    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(toastTitles()).toContain("Invalid user ID")
    expect(api.post).not.toHaveBeenCalledWith("/friendships/requests", expect.anything())

    await user.clear(id)
    await user.type(id, "11111111-1111-1111-1111-111111111111")
    await user.click(screen.getByRole("button", { name: "Add" }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/friendships/requests", { friendId: "11111111-1111-1111-1111-111111111111" }))
    expect(toastTitles()).toContain("Request sent")
  })

  it("accepts and rejects incoming requests by name", async () => {
    const user = userEvent.setup()
    await renderProfile()

    await user.click(await screen.findByRole("button", { name: "Accept request from Ada Lovelace" }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/friendships/requests/fr-1/accept"))
    expect(toastTitles()).toContain("Friend added")

    await user.click(await screen.findByRole("button", { name: "Reject request from Ada Lovelace" }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/friendships/requests/fr-1/reject"))
    expect(toastTitles()).toContain("Request rejected")
  })

  it("removes a friend", async () => {
    const user = userEvent.setup()
    await renderProfile()

    await user.click(await screen.findByRole("button", { name: "Remove Grace Hopper" }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/friendships/user-grace"))
    expect(toastTitles()).toContain("Friend removed")
  })
})
