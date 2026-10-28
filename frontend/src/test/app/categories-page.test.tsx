import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import CategoriesPage from "@/app/(app)/categories/page"
import { api } from "@/lib/api"
import { forgetOrigin, rememberOrigin, takeOrigin } from "@/lib/shared-origin"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import type { Category } from "@/types/category"

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))
// The sheet's progress stays where each run starts, so its opening pose can be read off the panel;
// a close lands at once.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>()
  return {
    ...actual,
    animate: (...args: Parameters<typeof actual.animate>) => {
      const [value, to] = args as unknown as [import("framer-motion").MotionValue<number>, number]
      if (typeof to !== "number" || typeof value?.set !== "function") return actual.animate(...args)
      if (to === 0) value.set(0)
      const done = to === 0 ? Promise.resolve() : new Promise<void>(() => undefined)
      return { stop: () => undefined, then: (onDone: () => void) => done.then(onDone) }
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
  useToastStore.getState().clear()
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

afterEach(() => useToastStore.getState().clear())

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
      fireEvent.keyDown(window, { key: "с", code: "KeyC" })
    } else {
      await userEvent.click(screen.getByRole("button", { name: path === "empty state" ? "Create a category" : "New category" }))
    }
    const dialog = screen.getByRole("dialog", { name: "New category" })
    expect(dialog.style.animation).toBe("none")
    // No usable origin (the button has no box here, the stale card is not this opening's): it
    // rises from just below at 95% instead of growing out of anything.
    await waitFor(() => expect(dialog.style.transform).toContain("translateY(20px) scaleX(0.95) scaleY(0.95)"))
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
    fireEvent.keyDown(window, { key: "c", code: "KeyC" })
    expect(screen.queryByRole("dialog", { name: "New category" })).toBeNull()
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
  })
})

describe("Category notices", () => {
  it.each([{ ctrlKey: true }, { shiftKey: true }, { isComposing: true }])("ignores modified or composing C: %o", async (properties) => {
    render(<CategoriesPage />)
    await screen.findByText("Work")
    fireEvent.keyDown(document.body, { key: "с", code: "KeyC", ...properties })
    expect(screen.queryByRole("dialog", { name: "New category" })).toBeNull()
  })

  it("leaves C in a field and behind an unrelated overlay alone", async () => {
    render(<CategoriesPage />)
    await screen.findByText("Work")
    const input = document.body.appendChild(document.createElement("input"))
    fireEvent.keyDown(input, { key: "c", code: "KeyC" })
    const overlay = document.body.appendChild(document.createElement("div"))
    overlay.setAttribute("role", "dialog")
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC" })
    expect(screen.queryByRole("dialog", { name: "New category" })).toBeNull()
    input.remove()
    overlay.remove()
  })
  it("reports a failed load with a concise error heading", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("offline"))
    render(<CategoriesPage />)
    await waitFor(() => expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ type: "error", title: "Couldn't load categories" }),
    ]))
  })

  it("announces creation calmly after the category has been saved", async () => {
    render(<CategoriesPage />)
    await userEvent.click(await screen.findByRole("button", { name: "New category" }))
    await userEvent.type(screen.getByRole("textbox", { name: /Name/ }), "Personal")
    await userEvent.click(screen.getByRole("button", { name: "Create category" }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/categories/api/v1/categories", expect.objectContaining({ name: "Personal" })))
    await waitFor(() => expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ type: "success", title: "Category created" }),
    ]))
  })
})

describe("Category task counts", () => {
  const serve = (counts: unknown) =>
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.endsWith("/category-counts")) {
        if (counts instanceof Error) throw counts
        return { data: counts }
      }
      return { data: [category, { ...category, id: "home", name: "Home", description: null }] }
    })

  it("draws each card with its open-task count, and a category with none as having none", async () => {
    serve([{ categoryId: "work", openCount: 3 }])
    render(<CategoriesPage />)
    expect(await screen.findByRole("img", { name: "3 open tasks" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "0 open tasks" })).toBeInTheDocument()
  })

  it("leaves the counts off when they cannot be read, and still lists the categories", async () => {
    serve(new Error("old server"))
    render(<CategoriesPage />)
    expect(await screen.findByRole("button", { name: "Edit category Work" })).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: /open task/ })).toBeNull()
  })
})
