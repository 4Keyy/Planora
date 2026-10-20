import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ProfilePage from "@/app/(app)/profile/page"
import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import type { UserDto } from "@/types/auth"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  parseApiResponse: (data: unknown) => data,
  getApiErrorMessage: () => "Request failed",
}))
vi.mock("@/lib/auth-public", () => ({ refreshAccessToken: vi.fn().mockRejectedValue(new Error("signed out")) }))

const user: UserDto = {
  id: "user-1", email: "alex@example.com", firstName: "Alex", lastName: "Morgan",
  isEmailVerified: true, status: "Active", twoFactorEnabled: false, createdAt: "2026-01-01T00:00:00Z",
}
const emptyPage = { items: [], totalCount: 0, pageNumber: 1, pageSize: 10 }

beforeEach(() => {
  vi.clearAllMocks()
  useToastStore.getState().clear()
  useAuthStore.setState({
    isAuthenticated: true, hasHydrated: true, hasRestoredSession: true,
    roles: ["User"], isTokenValid: () => true,
    user: { userId: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
  })
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === "/auth/api/v1/users/me") return { data: user }
    if (url.endsWith("/sessions") || url.endsWith("/requests")) return { data: [] }
    if (url.endsWith("/security")) return { data: { activeSessionsCount: 0, failedLoginAttempts: 0, twoFactorEnabled: false } }
    return { data: emptyPage }
  })
  vi.mocked(api.put).mockResolvedValue({ data: user })
  vi.mocked(api.post).mockResolvedValue({ data: user })
})

afterEach(() => useToastStore.getState().clear())

async function renderProfile() {
  render(<ProfilePage />)
  await waitFor(() => expect(screen.getByLabelText("First name")).toHaveValue("Alex"))
}

describe("profile name validation", () => {
  it.each([
    ["First name", "Alex1", "Use letters, spaces, hyphens or apostrophes"],
    ["Last name", "Morgan@", "Use letters, spaces, hyphens or apostrophes"],
    ["First name", "A".repeat(101), "At most 100 characters"],
    ["Last name", "M".repeat(101), "At most 100 characters"],
    ["First name", "   ", "Enter your name"],
    ["Last name", "", "Enter your name"],
  ])("refuses %s before sending: %s", async (label, value, message) => {
    await renderProfile()
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true")
    expect(api.put).not.toHaveBeenCalled()
  })

  it.each([
    ["  Анна-Мария  ", " O'Connor ", "Анна-Мария", "O'Connor"],
    [`  ${"Ё".repeat(100)}  `, "M".repeat(100), "Ё".repeat(100), "M".repeat(100)],
    [" A ", " Б ", "A", "Б"],
  ])("trims server-valid profile names and keeps the single-letter minimum", async (firstName, lastName, first, last) => {
    await renderProfile()
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: firstName } })
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: lastName } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/auth/api/v1/users/me", expect.objectContaining({ firstName: first, lastName: last })))
  })
})

describe("friend invitation email length", () => {
  it("rejects more than 255 characters before sending", async () => {
    await renderProfile()
    fireEvent.change(screen.getByLabelText("By email"), { target: { value: `${"a".repeat(244)}@example.com` } })
    fireEvent.keyDown(screen.getByLabelText("By email"), { key: "Enter" })
    expect(api.post).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ type: "error", title: "Invalid email", description: "At most 255 characters" }),
    ])
  })

  it("trims and accepts exactly 255 characters", async () => {
    const email = `${"a".repeat(243)}@example.com`
    await renderProfile()
    fireEvent.change(screen.getByLabelText("By email"), { target: { value: ` ${email} ` } })
    fireEvent.keyDown(screen.getByLabelText("By email"), { key: "Enter" })
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/api/v1/friendships/requests/by-email", { email }))
  })
})

describe("avatar upload validation", () => {
  const limit = 5 * 1024 * 1024
  function fileOf(type: string, size = 1): File {
    const file = new File(["x"], "photo", { type })
    Object.defineProperty(file, "size", { value: size })
    return file
  }

  it("offers only the server's three media types in both pickers", async () => {
    await renderProfile()
    for (const picker of screen.getAllByLabelText("Upload profile photo")) {
      expect(picker).toHaveAttribute("accept", "image/jpeg,image/png,image/webp")
    }
  })

  it.each(["image/gif", "image/svg+xml", "text/plain", ""])("refuses unsupported media %s before sending", async (type) => {
    await renderProfile()
    fireEvent.change(screen.getAllByLabelText("Upload profile photo")[0], { target: { files: [fileOf(type)] } })
    expect(api.post).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ title: "Couldn't upload avatar", description: "Choose a JPEG, PNG or WebP photo." }),
    ])
  })

  it.each([
    [limit + 1, "Choose a photo up to 5 MiB."],
    [0, "Choose a photo that isn't empty."],
  ])("refuses a file of %s bytes before sending", async (size, description) => {
    await renderProfile()
    fireEvent.change(screen.getAllByLabelText("Upload profile photo")[0], { target: { files: [fileOf("image/png", size)] } })
    expect(api.post).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ title: "Couldn't upload avatar", description })])
  })

  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s at exactly 5 MiB", async (type) => {
    await renderProfile()
    const file = fileOf(type, limit)
    fireEvent.change(screen.getAllByLabelText("Upload profile photo")[1], { target: { files: [file] } })
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/api/v1/users/me/avatar", expect.any(FormData), expect.objectContaining({ headers: { "Content-Type": "multipart/form-data" } })))
    const form = vi.mocked(api.post).mock.calls[0][1] as FormData
    expect(form.get("file")).toBe(file)
  })

  it.each([
    [413, "Choose a photo up to 5 MiB."],
    [415, "Choose a JPEG, PNG or WebP photo."],
  ])("explains HTTP %s separately", async (status, description) => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status } })
    await renderProfile()
    fireEvent.change(screen.getAllByLabelText("Upload profile photo")[0], { target: { files: [fileOf("image/png")] } })
    await waitFor(() => expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ title: "Couldn't upload avatar", description }),
    ]))
  })
})
