import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useMemo } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import CategoriesPage from "@/app/(app)/categories/page"
import { api } from "@/lib/api"
import { forgetOrigin, rememberOrigin, takeOrigin } from "@/lib/shared-origin"
import { useAuthStore } from "@/store/auth"
import type { Category } from "@/types/category"

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))
const animation = vi.hoisted(() => ({ set: vi.fn() }))
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>()
  return {
    ...actual,
    useAnimationControls: () => {
      const controls = actual.useAnimationControls()
      return useMemo(() => ({
        ...controls,
        set: (...args: Parameters<typeof controls.set>) => {
          animation.set(...args)
          return controls.set(...args)
        },
      }), [controls])
    },
  }
})
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  parseApiResponse: (response: unknown) => response,
}))

const category: Category = { id: "work", name: "Work", description: "Projects", color: "#0EA5E9", icon: "Briefcase" }

function recordStaleCard() {
  const element = document.createElement("div")
  element.getBoundingClientRect = () => new DOMRect(24, 160, 320, 90)
  rememberOrigin(element)
}

beforeEach(() => {
  vi.clearAllMocks()
  forgetOrigin()
  useAuthStore.setState({
    user: { userId: "owner", email: "owner@example.com", firstName: "Owner", lastName: "User" },
    accessToken: "test-access-token",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    roles: ["User"], emailVerified: true, isAuthenticated: true, hasHydrated: true, hasRestoredSession: true,
  })
  vi.mocked(api.get).mockResolvedValue({ data: [category] })
  vi.mocked(api.post).mockResolvedValue({ data: {} })
  vi.mocked(api.put).mockResolvedValue({ data: {} })
})

describe("Category motion parity", () => {
  it("animates the first loaded grid instead of disabling card entrances", async () => {
    render(<CategoriesPage />)
    const name = await screen.findByText("Work")
    const card = name.closest("[data-category-card]")!.parentElement as HTMLElement
    expect(Number(card.style.opacity)).toBeLessThan(1)
  })

  it.each(["button", "shortcut", "empty state"])("opens New Category with the task's centred motion from the %s", async (path) => {
    if (path === "empty state") vi.mocked(api.get).mockResolvedValue({ data: [] })
    render(<CategoriesPage />)
    await screen.findByText(path === "empty state" ? "No categories yet" : "Work")
    recordStaleCard()
    if (path === "shortcut") {
      fireEvent.keyDown(window, { key: "c" })
    } else {
      await userEvent.click(screen.getByRole("button", { name: path === "empty state" ? "Create a category" : "New category" }))
    }
    const dialog = screen.getByRole("dialog", { name: "New category" })
    expect(dialog.style.animation).toBe("none")
    expect(animation.set).toHaveBeenCalledWith({ opacity: 0, scale: 0.95, x: 0, y: 20 })
    expect(takeOrigin()).toBeNull()
  })

  it("keeps typed category data while autosave updates the card, then seeds the next opening", async () => {
    render(<CategoriesPage />)
    await userEvent.click(await screen.findByRole("button", { name: "Edit category Work" }))
    const input = screen.getByRole("textbox", { name: /Name/ })
    await userEvent.clear(input)
    await userEvent.type(input, "Renamed work")
    await waitFor(() => expect(api.put).toHaveBeenCalled())
    expect(input).toHaveValue("Renamed work")
    await userEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await userEvent.click(screen.getByRole("button", { name: "Edit category Renamed work" }))
    expect(screen.getByRole("textbox", { name: /Name/ })).toHaveValue("Renamed work")
  })

  it("does not open New Category over another category modal via the C shortcut", async () => {
    render(<CategoriesPage />)
    await userEvent.click(await screen.findByRole("button", { name: "Edit category Work" }))
    act(() => screen.getByRole("button", { name: "Done" }).focus())
    fireEvent.keyDown(window, { key: "c" })
    expect(screen.queryByRole("dialog", { name: "New category" })).toBeNull()
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
  })
})
