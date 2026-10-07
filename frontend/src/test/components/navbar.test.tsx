import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Navbar } from "@/components/layout/navbar"
import { OPEN_PALETTE_EVENT } from "@/components/command-palette"
import { api } from "@/lib/api"
import { clearCsrfToken } from "@/lib/csrf"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: "/dashboard",
}))

vi.mock("next/navigation", () => ({
  usePathname: () => routerMocks.pathname,
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
    routerMocks.pathname = "/dashboard"
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

  const tabs = () => within(screen.getByTestId("navbar-desktop"))

  it("links the wordmark to the dashboard", () => {
    render(<Navbar />)
    expect(screen.getByRole("link", { name: "Planora, go to dashboard" })).toHaveAttribute("href", "/dashboard")
  })

  it("shows the three destinations without any hover, and marks the current one", () => {
    // They used to appear only while the pointer hovered over a pill — invisible on a
    // desktop until you went looking, and never shown to a keyboard user at all.
    routerMocks.pathname = "/tasks/completed"
    render(<Navbar />)
    const links = tabs().getAllByRole("link")
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/dashboard", "/tasks", "/categories"])
    expect(tabs().getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page")
    expect(tabs().getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current")
  })

  it("renders user initials in the avatar button once mounted", async () => {
    render(<Navbar />)
    await waitFor(() => expect(screen.getAllByText("AL").length).toBeGreaterThan(0))
  })

  it("opens the account menu with the right attributes and the person's details", async () => {
    const user = userEvent.setup()
    render(<Navbar />)

    const trigger = await screen.findByRole("button", { name: /User menu for Ada Lovelace/i })
    // A disclosure, not an ARIA menu: two plain buttons need no arrow-key contract.
    expect(trigger).not.toHaveAttribute("aria-haspopup")
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(trigger).toHaveAttribute("aria-controls", "navbar-account")

    await user.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    const menu = document.getElementById("navbar-account") as HTMLElement
    expect(within(menu).getByText("Ada Lovelace")).toBeInTheDocument()
    expect(within(menu).getByText("ada@example.com")).toBeInTheDocument()
  })

  it("navigates to the profile from the account menu", async () => {
    const user = userEvent.setup()
    render(<Navbar />)
    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/i }))
    await user.click(screen.getByRole("button", { name: "Profile" }))
    expect(routerMocks.push).toHaveBeenCalledWith("/profile")
  })

  it("signs out through the API, clears local auth and CSRF, and redirects", async () => {
    const user = userEvent.setup()
    render(<Navbar />)
    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/i }))
    await user.click(screen.getByRole("button", { name: "Sign out" }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/api/v1/auth/logout"))
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(clearCsrfToken).toHaveBeenCalledOnce()
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: "success", title: "Signed out" })
    expect(routerMocks.push).toHaveBeenCalledWith("/auth/login")
  })

  it("still clears local state when the logout call fails", async () => {
    vi.spyOn(api, "post").mockRejectedValueOnce(new Error("offline"))
    const user = userEvent.setup()
    render(<Navbar />)
    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/i }))
    await user.click(screen.getByRole("button", { name: "Sign out" }))
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    expect(routerMocks.push).toHaveBeenCalledWith("/auth/login")
  })

  it("closes the account menu on an outside click, and on Escape with focus returned", async () => {
    const user = userEvent.setup()
    render(<Navbar />)
    const trigger = await screen.findByRole("button", { name: /Ada Lovelace/i })

    await user.click(trigger)
    await user.click(document.body)
    await waitFor(() => expect(document.getElementById("navbar-account")).toBeNull())

    await user.click(trigger)
    await user.keyboard("{Escape}")
    await waitFor(() => expect(document.getElementById("navbar-account")).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it("opens the command palette from the search button", async () => {
    const user = userEvent.setup()
    const received: Event[] = []
    const listener = (e: Event) => received.push(e)
    window.addEventListener(OPEN_PALETTE_EVENT, listener)
    render(<Navbar />)
    // One button at every width: the droplet shows its ⌘K hint beside the icon from lg.
    const search = screen.getByRole("button", { name: "Search" })
    expect(search).toHaveAttribute("aria-keyshortcuts")
    search.getBoundingClientRect = () => ({ top: 22, left: 834, width: 98, height: 44, right: 932, bottom: 66, x: 834, y: 22, toJSON: () => ({}) })
    await user.click(search)
    expect(received).toHaveLength(1)
    // The palette grows out of the button, so the request says where the button is.
    expect((received[0] as CustomEvent).detail).toEqual({ origin: { top: 22, left: 834, width: 98, height: 44 } })
    window.removeEventListener(OPEN_PALETTE_EVENT, listener)
  })

  it("opens a sheet with the destinations and account actions on a phone", async () => {
    const user = userEvent.setup()
    render(<Navbar />)
    expect(screen.queryByTestId("navbar-mobile")).toBeNull()

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    const sheet = within(await screen.findByTestId("navbar-mobile"))
    expect(sheet.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page")
    expect(sheet.getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/tasks")
    expect(sheet.getByRole("link", { name: "Categories" })).toHaveAttribute("href", "/categories")
    expect(sheet.getByRole("button", { name: "Profile" })).toBeInTheDocument()
    expect(sheet.getByRole("button", { name: "Sign out" })).toBeInTheDocument()

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByTestId("navbar-mobile")).toBeNull())
    // Focus returns to the toggle rather than falling to <body> with the unmounted sheet.
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus()
  })

  it("floats as a droplet: a fixed capsule, its glass on a layer of its own", () => {
    const { container } = render(<Navbar />)
    const header = container.querySelector("header") as HTMLElement
    expect(header.parentElement).toHaveClass("fixed")
    // The blur is on a child layer, never on the header: backdrop-filter would make the
    // header the containing block of the menus' fixed descendants.
    expect(header.className).not.toContain("backdrop-blur")
    expect(header.querySelector('[aria-hidden="true"].backdrop-blur-xl')).not.toBeNull()
  })

  it("marks the current page with the ink drop", () => {
    routerMocks.pathname = "/categories"
    render(<Navbar />)
    const current = tabs().getByRole("link", { name: "Categories" })
    expect(current).toHaveClass("text-paper")
    expect(tabs().getByRole("link", { name: "Tasks" })).toHaveClass("text-ink-muted")
  })

  it("keeps one popover open at a time: the bell closes the phone sheet", async () => {
    const user = userEvent.setup()
    render(<Navbar />)
    await user.click(screen.getByRole("button", { name: "Open menu" }))
    expect(await screen.findByTestId("navbar-mobile")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Notifications/ }))
    await waitFor(() => expect(screen.queryByTestId("navbar-mobile")).toBeNull())
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument()
  })
})
