import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandPalette, OPEN_PALETTE_EVENT, requestPalette } from "@/components/command-palette"
import { OPEN_CAPTURE_EVENT } from "@/components/todos/quick-capture"
import { OPEN_SHORTCUTS_EVENT } from "@/components/ui/shortcuts-overlay"
import { invalidateFriends } from "@/hooks/use-friends"
import { useAuthStore } from "@/store/auth"
import type { FriendDto } from "@/types/auth"
import type { Todo } from "@/types/todo"

const push = vi.fn()
let pathname = "/tasks"
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => pathname }))

const get = vi.fn()
vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => get(...args) },
  // The real unwrapping: the categories endpoint answers `{ value: [...] }`.
  parseApiResponse: (response: unknown) =>
    response !== null && typeof response === "object" && "value" in response ? (response as { value: unknown }).value : response,
}))

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** A fresh account per test: the palette caches its last read per user. */
let me = ""
let accounts = 0

const at = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

function todo(over: Partial<Todo> & Pick<Todo, "id" | "title">): Todo {
  return { userId: me, status: "Todo", priority: "Medium", isPublic: false, isCompleted: false, tags: [], createdAt: at(-20), ...over }
}

const openTasks = () => [
  todo({ id: "t1", title: "Book the flights for the spring trip", description: "Lisbon in April", categoryId: "travel", categoryName: "Travel", categoryColor: "#0ea5e9", categoryIcon: "Plane", dueDate: at(5) }),
  todo({ id: "t2", title: "Renew the household insurance policy", categoryId: "home", categoryName: "Household", dueDate: at(-2), priority: "Urgent" }),
  todo({ id: "t3", title: "Pay the electricity bill", dueDate: at(0), sharedWithUserIds: ["ada"] }),
  todo({ id: "t4", title: "Quarterly report", userId: "ada", isPublic: true, status: "In Progress" }),
  // Carries only its category's id, as some reads do.
  todo({ id: "t5", title: "Pack the bags", categoryId: "home" }),
]
const doneTasks = () => [
  todo({ id: "d1", title: "Buy milk", status: "Done", isCompleted: true, completedAt: at(-1) }),
]
const CATEGORIES = [
  { id: "travel", name: "Travel", description: "Trips", color: "#0ea5e9", icon: "Plane" },
  { id: "home", name: "Household", color: null, icon: null },
  { id: "nameless", name: "  " },
]
const FRIENDS: FriendDto[] = [
  { id: "ada", email: "ada@example.test", firstName: "Ada", lastName: "Lovelace", profilePictureUrl: null, friendsSince: at(-100) },
]

function serve({ failTasks = false, open = openTasks(), done = doneTasks(), friends = FRIENDS } = {}) {
  get.mockImplementation((url: string, config?: { params?: { isCompleted?: boolean } }) => {
    if (url === "/todos/api/v1/todos") {
      const completed = Boolean(config?.params?.isCompleted)
      if (failTasks && !completed) return Promise.reject(new Error("offline"))
      return Promise.resolve({ data: { items: completed ? done : open } })
    }
    if (url === "/categories/api/v1/categories") return Promise.resolve({ data: { value: CATEGORIES } })
    if (url === "/friendships") return Promise.resolve({ data: { items: friends, hasNextPage: false } })
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}

function mockMotion(reduce = false) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduce,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.clearAllMocks()
  pathname = "/tasks"
  me = `me-${++accounts}`
  invalidateFriends()
  serve()
  useAuthStore.setState({ isAuthenticated: true, user: { userId: me, email: "me@example.test", firstName: "Me", lastName: "Self" } })
  mockMotion()
})

afterEach(() => {
  // Unmount first: signing the store out under a mounted palette is an update
  // nobody awaited, and the next read resolving after the test is another.
  cleanup()
  useAuthStore.setState({ isAuthenticated: false, user: undefined })
  document.documentElement.style.overflow = ""
  window.localStorage.clear()
  vi.restoreAllMocks()
})

// ─── Helpers ────────────────────────────────────────────────────────────────

const dialog = () => screen.queryByRole("dialog", { name: "Command palette" })
const field = () => screen.getByRole("combobox")
const options = () => screen.getAllByRole("option")
const optionTexts = () => options().map((o) => o.textContent ?? "")

async function openPalette() {
  const user = userEvent.setup()
  render(<CommandPalette />)
  await user.keyboard("{Control>}k{/Control}")
  await screen.findByRole("dialog", { name: "Command palette" })
  // Wait for the read, so the lists below are the loaded ones.
  await waitFor(() => expect(screen.queryByText("Loading tasks")).toBeNull())
  return user
}

function activeOption() {
  const id = field().getAttribute("aria-activedescendant")
  return id ? document.getElementById(id) : null
}

// ─── Opening and closing ────────────────────────────────────────────────────

describe("CommandPalette — opening and closing", () => {
  it("renders nothing for a signed-out visitor", async () => {
    useAuthStore.setState({ isAuthenticated: false })
    render(<CommandPalette />)
    await userEvent.keyboard("{Control>}k{/Control}")
    expect(dialog()).toBeNull()
  })

  it("opens on Ctrl+K, puts focus in the search field and closes on the same chord", async () => {
    const user = await openPalette()
    await waitFor(() => expect(field()).toHaveFocus())
    await user.keyboard("{Control>}k{/Control}")
    await waitFor(() => expect(dialog()).toBeNull())
  })

  it("answers the chord on a Cyrillic layout too", async () => {
    render(<CommandPalette />)
    fireEvent.keyDown(document.body, { key: "л", code: "KeyK", ctrlKey: true })
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument()
  })

  it("ignores the chord with another modifier held", async () => {
    render(<CommandPalette />)
    fireEvent.keyDown(document.body, { key: "k", code: "KeyK", ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: "t", code: "KeyK", ctrlKey: true })
    expect(dialog()).toBeNull()
  })

  it("opens when the app bar asks, once however often it asks", async () => {
    render(<CommandPalette />)
    const button = document.createElement("button")
    button.getBoundingClientRect = () => ({ top: 20, left: 800, width: 96, height: 44, right: 896, bottom: 64, x: 800, y: 20, toJSON: () => ({}) })
    const received: Event[] = []
    window.addEventListener(OPEN_PALETTE_EVENT, (e) => received.push(e))
    act(() => requestPalette(button))
    await screen.findByRole("dialog", { name: "Command palette" })
    act(() => requestPalette())
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect((received[0] as CustomEvent).detail).toEqual({ origin: { top: 20, left: 800, width: 96, height: 44 } })
    expect((received[1] as CustomEvent).detail).toEqual({ origin: undefined })
  })

  it("closes from the backdrop", async () => {
    await openPalette()
    const backdrop = document.querySelector(".backdrop-surface") as HTMLElement
    fireEvent.click(backdrop)
    await waitFor(() => expect(dialog()).toBeNull())
  })

  it("steps back on Escape: the query, then the scope, then the palette", async () => {
    const user = await openPalette()
    await user.type(field(), "#trav")
    await user.keyboard("{Tab}")
    await user.type(field(), "boo")
    await user.keyboard("{Escape}")
    expect(field()).toHaveValue("")
    expect(screen.getByRole("button", { name: "Stop narrowing to Travel" })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("button", { name: "Stop narrowing to Travel" })).toBeNull()
    expect(dialog()).not.toBeNull()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(dialog()).toBeNull())
  })

  it("locks page scroll while open", async () => {
    const user = await openPalette()
    expect(document.documentElement.style.overflow).toBe("hidden")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(document.documentElement.style.overflow).toBe(""))
  })

  it("keeps the keys pressed inside it away from the page behind", async () => {
    const user = await openPalette()
    const page = vi.fn()
    window.addEventListener("keydown", page)
    await user.type(field(), "x")
    window.removeEventListener("keydown", page)
    expect(page).not.toHaveBeenCalled()
  })

  it("closes when the session ends", async () => {
    await openPalette()
    act(() => useAuthStore.setState({ isAuthenticated: false }))
    expect(dialog()).toBeNull()
    expect(document.documentElement.style.overflow).toBe("")
  })
})

// ─── Nothing typed ──────────────────────────────────────────────────────────

describe("CommandPalette — nothing typed", () => {
  it("starts with what is next, latest deadline last, and the open questions as chips", async () => {
    await openPalette()
    expect(screen.getByText("Up next")).toBeInTheDocument()
    expect(options()[0]).toHaveTextContent("Renew the household insurance policy")
    expect(options()[0]).toHaveTextContent("2 days late")
    expect(screen.getByRole("button", { name: "Overdue, 1 task" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Due today, 1 task" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Urgent/ })).not.toBeNull()
    // Views with nothing in them are not offered.
    expect(screen.queryByRole("button", { name: /^Shared, 0/ })).toBeNull()
  })

  it("narrows to a view from its chip", async () => {
    const user = await openPalette()
    await user.click(screen.getByRole("button", { name: "Due today, 1 task" }))
    expect(screen.getByRole("button", { name: "Stop narrowing to Due today" })).toBeInTheDocument()
    expect(optionTexts()).toEqual([expect.stringContaining("Pay the electricity bill")])
    expect(field()).toHaveFocus()
  })

  it("follows the combobox pattern: focus stays in the field, the selection moves and wraps", async () => {
    const user = await openPalette()
    const first = field().getAttribute("aria-activedescendant")
    await user.keyboard("{ArrowDown}")
    expect(field()).toHaveFocus()
    expect(field().getAttribute("aria-activedescendant")).not.toBe(first)
    await user.keyboard("{ArrowUp}{ArrowUp}")
    expect(activeOption()).toBe(options().at(-1))
    await user.keyboard("{PageUp}")
    expect(activeOption()).toBe(options().at(-6))
    await user.keyboard("{PageDown}{PageDown}")
    expect(activeOption()).toBe(options().at(-1))
  })

  it("follows the pointer, and runs what is clicked", async () => {
    const user = await openPalette()
    const dashboard = options().find((o) => o.textContent?.startsWith("Dashboard"))!
    fireEvent.pointerMove(dashboard)
    expect(dashboard).toHaveAttribute("aria-selected", "true")
    await user.click(dashboard)
    expect(push).toHaveBeenCalledWith("/dashboard")
  })

  it("remembers what was opened, and shows it first next time", async () => {
    const user = await openPalette()
    await user.type(field(), "insurance")
    await user.keyboard("{Enter}")
    expect(push).toHaveBeenCalledWith("/branch/t2")
    await waitFor(() => expect(dialog()).toBeNull())
    await user.keyboard("{Control>}k{/Control}")
    await screen.findByRole("dialog", { name: "Command palette" })
    expect(screen.getByText("Recent")).toBeInTheDocument()
    expect(options()[0]).toHaveTextContent("Renew the household insurance policy")
  })

  it("describes the highlighted task beside the list", async () => {
    const user = await openPalette()
    await user.type(field(), "flights")
    const details = screen.getByRole("complementary", { name: "Details" })
    expect(within(details).getByText("Lisbon in April")).toBeInTheDocument()
    expect(within(details).getByRole("img", { name: /Priority 3 of 5/ })).toBeInTheDocument()
    expect(within(details).getByText("Only you")).toBeInTheDocument()
  })

  it("names a task's category from the category list when the task carries only its id", async () => {
    const user = await openPalette()
    await user.type(field(), "pack")
    expect(options()[0]).toHaveTextContent("Household")
    expect(within(screen.getByRole("complementary", { name: "Details" })).getByText("Household")).toBeInTheDocument()
  })
})

// ─── Searching ──────────────────────────────────────────────────────────────

describe("CommandPalette — searching", () => {
  it("finds a task by a subsequence of its title and marks the letters that matched", async () => {
    const user = await openPalette()
    await user.type(field(), "bfl")
    expect(options()[0]).toHaveTextContent("Book the flights")
    expect(Array.from(options()[0].querySelectorAll("mark")).map((m) => m.textContent)).toEqual(["B", "fl"])
  })

  it("says on every tab how many results it holds, and announces the count", async () => {
    const user = await openPalette()
    await user.type(field(), "pay")
    expect(screen.getByRole("button", { name: "Tasks, 1 result" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "People, 0 results" })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("1 result")
  })

  it("opens the selected task's branch on Enter", async () => {
    const user = await openPalette()
    await user.type(field(), "insurance")
    await user.keyboard("{Enter}")
    expect(push).toHaveBeenCalledWith("/branch/t2")
  })

  it("sends a task to a new tab with Ctrl+Enter or a middle click, and stays open", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const user = await openPalette()
    await user.type(field(), "flights")
    await user.keyboard("{Control>}{Enter}{/Control}")
    expect(open).toHaveBeenCalledWith("/branch/t1", "_blank", "noopener,noreferrer")
    fireEvent(options()[0], new MouseEvent("auxclick", { bubbles: true, button: 1 }))
    expect(open).toHaveBeenCalledTimes(2)
    expect(push).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
  })

  it("offers to make a query that matches nothing a task, typed in quick capture", async () => {
    const received: CustomEvent[] = []
    const listener = (e: Event) => received.push(e as CustomEvent)
    window.addEventListener(OPEN_CAPTURE_EVENT, listener)
    const user = await openPalette()
    await user.type(field(), "zzzzzzz")
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("No results")
    await user.keyboard("{Enter}")
    await waitFor(() => expect(received).toHaveLength(1))
    expect(received[0].detail).toEqual({ title: "zzzzzzz" })
    expect(push).not.toHaveBeenCalled()
    window.removeEventListener(OPEN_CAPTURE_EVENT, listener)
  })

  it("goes to Tasks first when the screen it was opened on has no capture", async () => {
    pathname = "/categories"
    const received: CustomEvent[] = []
    const listener = (e: Event) => received.push(e as CustomEvent)
    window.addEventListener(OPEN_CAPTURE_EVENT, listener)
    const user = await openPalette()
    await user.type(field(), "milk run")
    await user.keyboard("{Enter}")
    expect(push).toHaveBeenCalledWith("/tasks")
    expect(received[0].detail).toEqual({ title: "milk run" })
    window.removeEventListener(OPEN_CAPTURE_EVENT, listener)
  })

  it("opens the shortcut map from its command", async () => {
    const shown = vi.fn()
    window.addEventListener(OPEN_SHORTCUTS_EVENT, shown)
    const user = await openPalette()
    await user.type(field(), ">shortcuts")
    expect(options()[0]).toHaveTextContent("Keyboard shortcuts")
    await user.keyboard("{Enter}")
    await waitFor(() => expect(shown).toHaveBeenCalledTimes(1))
    window.removeEventListener(OPEN_SHORTCUTS_EVENT, shown)
  })

  it("clears the query from its button", async () => {
    const user = await openPalette()
    await user.type(field(), "abc")
    await user.click(screen.getByRole("button", { name: "Clear search" }))
    expect(field()).toHaveValue("")
    expect(field()).toHaveFocus()
  })

  it("shows all of one kind from a section's link", async () => {
    serve({ open: Array.from({ length: 8 }, (_, i) => todo({ id: `b${i}`, title: `Book number ${i}` })) })
    const user = await openPalette()
    await user.type(field(), "book")
    expect(options().filter((o) => o.textContent?.startsWith("Book number"))).toHaveLength(6)
    await user.click(screen.getByText("Show all 8"))
    expect(screen.getByRole("button", { name: "Tasks, 8 results" })).toHaveAttribute("aria-pressed", "true")
    expect(options().filter((o) => o.textContent?.startsWith("Book number"))).toHaveLength(8)
  })

  it("deduplicates tasks that arrive twice", async () => {
    const tasks = openTasks()
    serve({ open: [...tasks, tasks[0]] })
    const user = await openPalette()
    await user.type(field(), "flights")
    expect(options().filter((o) => o.textContent?.includes("Book the flights"))).toHaveLength(1)
  })

  it("still navigates when the task read fails, and offers to try again", async () => {
    serve({ failTasks: true })
    const user = await openPalette()
    expect(screen.getByText(/didn’t load/)).toBeInTheDocument()
    await user.type(field(), "categor")
    expect(options()[0]).toHaveTextContent("Categories")
    const reads = get.mock.calls.length
    await user.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(reads))
    await user.keyboard("{Enter}")
    expect(push).toHaveBeenCalledWith("/categories")
  })
})

// ─── Hidden tasks ───────────────────────────────────────────────────────────

describe("CommandPalette — hidden tasks", () => {
  const veil = (row: HTMLElement) => row.querySelector("[data-veil]")?.getAttribute("data-veil")
  const details = () => screen.getByRole("complementary", { name: "Details" })

  it("reads hidden tasks in full, never recommends one, and finds it blurred", async () => {
    serve({ open: [...openTasks(), todo({ id: "h1", title: "Surprise party for Ada", description: "Saturday at eight", hidden: true, dueDate: at(-5) })] })
    const user = await openPalette()
    // The palette is the one reader that asks for hidden rows unredacted.
    const reads = get.mock.calls.filter(([url]) => url === "/todos/api/v1/todos")
    expect(reads.length).toBeGreaterThan(0)
    for (const [, config] of reads) expect(config.params.revealHidden).toBe(true)
    // The most overdue open task, and still not in Up next.
    expect(optionTexts().some((text) => text.includes("Surprise party"))).toBe(false)

    await user.type(field(), "surprise")
    const row = options()[0]
    expect(row).toHaveAttribute("aria-selected", "true")
    // First in a fresh list is not reaching for it: still blurred, details held back.
    expect(veil(row)).toBe("veiled")
    expect(details()).toHaveTextContent("Hidden task")
    expect(details()).not.toHaveTextContent("Saturday at eight")

    fireEvent.pointerMove(row)
    expect(veil(row)).toBe("revealed")
    expect(details()).toHaveTextContent("Saturday at eight")

    // A new question veils it again.
    await user.type(field(), " party")
    expect(veil(options()[0])).toBe("veiled")
  })

  it("reveals a hidden task reached with the arrows, and veils it when the highlight moves on", async () => {
    serve({ open: [todo({ id: "a", title: "Surprise party", hidden: true }), todo({ id: "b", title: "Surprise visit" })] })
    const user = await openPalette()
    await user.type(field(), "surprise")
    const hidden = options()[0]
    expect(veil(hidden)).toBe("veiled")
    await user.keyboard("{ArrowDown}{ArrowUp}")
    expect(activeOption()).toBe(hidden)
    expect(veil(hidden)).toBe("revealed")
    await user.keyboard("{ArrowDown}")
    expect(veil(hidden)).toBe("veiled")
  })
})

// ─── Narrowing ──────────────────────────────────────────────────────────────

describe("CommandPalette — narrowing", () => {
  it("limits the search with # and narrows into a category with Tab", async () => {
    const user = await openPalette()
    await user.type(field(), "#trav")
    expect(screen.getByRole("button", { name: "Categories, 1 result" })).toHaveAttribute("aria-pressed", "true")
    expect(options()[0]).toHaveTextContent("Travel")
    await user.keyboard("{Tab}")
    expect(field()).toHaveValue("")
    expect(field()).toHaveFocus()
    expect(field()).toHaveAccessibleName("Search in Travel")
    expect(optionTexts()).toEqual([expect.stringContaining("Book the flights")])
    // Inside a category its name is not repeated on every row.
    expect(options()[0]).not.toHaveTextContent("Travel")
    await user.keyboard("{Backspace}")
    expect(screen.queryByRole("button", { name: "Stop narrowing to Travel" })).toBeNull()
    expect(screen.getByText("Up next")).toBeInTheDocument()
  })

  it("narrows to a person with @ and Enter, and back out with the bar", async () => {
    const user = await openPalette()
    await user.type(field(), "@ada")
    expect(options()[0]).toHaveTextContent("Ada Lovelace")
    await user.keyboard("{Enter}")
    const texts = optionTexts()
    expect(texts).toHaveLength(2)
    expect(texts.join(" ")).toContain("from Ada Lovelace")
    expect(texts.join(" ")).toContain("with Ada Lovelace")
    await user.click(screen.getByRole("button", { name: "All results" }))
    expect(screen.getByText("Up next")).toBeInTheDocument()
  })

  it("searches inside the scope, and can still create", async () => {
    const user = await openPalette()
    await user.type(field(), "#trav")
    await user.keyboard("{Tab}")
    await user.type(field(), "insurance")
    expect(optionTexts()).toEqual([expect.stringContaining("Create task “insurance”")])
    await user.click(screen.getByRole("button", { name: "Stop narrowing to Travel" }))
    expect(options()[0]).toHaveTextContent("Renew the household insurance policy")
  })

  it("hands the tab back its say when one is chosen over an operator", async () => {
    const user = await openPalette()
    await user.type(field(), "#trav")
    await user.click(screen.getByRole("button", { name: /^Tasks/ }))
    expect(field()).toHaveValue("trav")
    expect(screen.getByRole("button", { name: "Tasks, 1 result" })).toHaveAttribute("aria-pressed", "true")
  })

  it("explains an empty tab", async () => {
    serve({ friends: [] })
    const user = await openPalette()
    await user.click(screen.getByRole("button", { name: "People" }))
    expect(screen.getByText("No friends yet")).toBeInTheDocument()
  })
})
