import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Navbar } from "@/components/layout/navbar"
import { api } from "@/lib/api"
import { clearCsrfToken } from "@/lib/csrf"
import { TASK_CREATED_EVENT } from "@/lib/events"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({
    push: routerMocks.push,
  }),
}))

vi.mock("@/lib/csrf", async () => {
  const actual = await vi.importActual<typeof import("@/lib/csrf")>("@/lib/csrf")
  return {
    ...actual,
    clearCsrfToken: vi.fn(),
  }
})

describe("Navbar", () => {
  beforeEach(() => {
    routerMocks.push.mockClear()
    vi.mocked(clearCsrfToken).mockClear()
    vi.spyOn(api, "post").mockResolvedValue({ data: {} })
    useToastStore.setState({ toasts: [] })
    useAuthStore.setState({
      user: {
        userId: "user-1",
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
      },
      accessToken: "access-token",
      isAuthenticated: true,
    })
  })

  // Both the desktop pill and the mobile bar render into the DOM (visibility is
  // CSS-only via Tailwind responsive classes, which jsdom does not apply), so
  // queries for elements that exist in both variants (brand link, avatar, quick
  // create) are scoped to the relevant testid root to stay unambiguous.
  const desktop = () => within(screen.getByTestId("navbar-desktop"))
  const mobile = () => within(screen.getByTestId("navbar-mobile"))
  const desktopPill = () => desktop().getByRole("link", { name: /Planora/i }).closest("div[class]")!

  it("renders the Planora brand link pointing to /dashboard", () => {
    render(<Navbar />)
    expect(desktop().getByRole("link", { name: /Planora/i })).toHaveAttribute("href", "/dashboard")
  })

  it("renders user initials in the avatar button once mounted", async () => {
    render(<Navbar />)
    await waitFor(() => expect(desktop().getByText("AL")).toBeInTheDocument())
  })

  it("avatar button has the correct aria attributes", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    const trigger = await screen.findByRole("button", { name: /User menu for Ada Lovelace/i })
    expect(trigger).toHaveAttribute("aria-haspopup", "menu")
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    await user.click(trigger)

    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("menu")).toBeInTheDocument()
  })

  it("dropdown shows user display name and email after opening", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    await user.click(await screen.findByRole("button", { name: /User menu for Ada Lovelace/i }))

    await waitFor(() => {
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument()
      expect(screen.getByText("ada@example.com")).toBeInTheDocument()
    })
  })

  it("opens the menu and navigates to profile", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/i }))
    await user.click(screen.getByRole("menuitem", { name: "Profile" }))

    expect(routerMocks.push).toHaveBeenCalledWith("/profile")
  })

  it("logs out through the API, clears local auth and CSRF, emits toast, and redirects", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/i }))
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/api/v1/auth/logout"))
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(clearCsrfToken).toHaveBeenCalledOnce()
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: "success",
      title: "Logged out",
    })
    expect(routerMocks.push).toHaveBeenCalledWith("/auth/login")
  })

  it("nav tabs link to Dashboard, Todos, and Categories (not Friends)", async () => {
    const user = userEvent.setup()
    render(<Navbar />)
    // Hover the pill to expand the nav section
    const pill = desktopPill()
    await user.hover(pill)
    await waitFor(() => {
      const links = screen.getAllByRole("link")
      const hrefs = links.map(l => l.getAttribute("href"))
      expect(hrefs).toContain("/dashboard")
      expect(hrefs).toContain("/tasks")
      expect(hrefs).toContain("/categories")
      expect(hrefs).not.toContain("/profile")
    })
  })

  it("dispatches TASK_CREATED_EVENT after quick-creating a task via the navbar input", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    const received: Event[] = []
    const listener = (e: Event) => received.push(e)
    window.addEventListener(TASK_CREATED_EVENT, listener)

    // Hover to expand, then click + to enter create mode
    const pill = desktopPill()
    await user.hover(pill)
    const addBtn = await screen.findByRole("button", { name: "Create task" })
    await user.click(addBtn)

    const input = await screen.findByPlaceholderText(/Add task/i)
    await user.type(input, "New quick task")
    await user.keyboard("{Enter}")

    await waitFor(() => expect(received).toHaveLength(1))
    expect(received[0].type).toBe(TASK_CREATED_EVENT)

    window.removeEventListener(TASK_CREATED_EVENT, listener)
  })

  it("still clears local state when logout API fails", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("offline"))
    const user = userEvent.setup()
    render(<Navbar />)

    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/i }))
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }))

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    expect(routerMocks.push).toHaveBeenCalledWith("/auth/login")
  })

  it("shows an error toast when quick-create API call fails", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("server error"))
    const user = userEvent.setup()
    render(<Navbar />)

    const pill = desktopPill()
    await user.hover(pill)
    await user.click(await screen.findByRole("button", { name: "Create task" }))
    await user.type(await screen.findByPlaceholderText(/Add task/i), "Failing task")
    await user.keyboard("{Enter}")

    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        type: "error",
        title: "Failed to create task",
      }),
    )
  })

  it("exits create mode when the cancel button is clicked", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    const pill = desktopPill()
    await user.hover(pill)
    await user.click(await screen.findByRole("button", { name: "Create task" }))
    await screen.findByPlaceholderText(/Add task/i)

    await user.click(screen.getByRole("button", { name: "Cancel create task" }))

    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Add task/i)).not.toBeInTheDocument(),
    )
  })

  it("exits create mode when Escape is pressed", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    const pill = desktopPill()
    await user.hover(pill)
    await user.click(await screen.findByRole("button", { name: "Create task" }))
    const input = await screen.findByPlaceholderText(/Add task/i)

    await user.type(input, "some text")
    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Add task/i)).not.toBeInTheDocument(),
    )
  })

  it("closes dropdown and collapses pill when clicking outside both", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/i }))
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument())

    await user.click(document.body)

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
  })

  // ── Mobile bar (touch devices) ────────────────────────────────────────────

  it("mobile bar opens a sheet with navigation tabs and account actions", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    await user.click(mobile().getByRole("button", { name: /open menu/i }))

    const dashboard = await mobile().findByRole("menuitem", { name: /Dashboard/i })
    expect(dashboard).toHaveAttribute("href", "/dashboard")
    expect(mobile().getByRole("menuitem", { name: /Tasks/i })).toHaveAttribute("href", "/tasks")
    expect(mobile().getByRole("menuitem", { name: /Categories/i })).toHaveAttribute("href", "/categories")
    expect(mobile().getByRole("menuitem", { name: "Profile" })).toBeInTheDocument()
    expect(mobile().getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument()
  })

  it("mobile sheet quick-create dispatches TASK_CREATED_EVENT", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    const received: Event[] = []
    const listener = (e: Event) => received.push(e)
    window.addEventListener(TASK_CREATED_EVENT, listener)

    await user.click(mobile().getByRole("button", { name: /open menu/i }))
    const input = await mobile().findByPlaceholderText(/add a task/i)
    await user.type(input, "Mobile task")
    await user.keyboard("{Enter}")

    await waitFor(() => expect(received).toHaveLength(1))
    expect(received[0].type).toBe(TASK_CREATED_EVENT)

    window.removeEventListener(TASK_CREATED_EVENT, listener)
  })
})
