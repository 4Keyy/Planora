import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandPalette } from "@/components/command-palette"
import { useAuthStore } from "@/store/auth"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

const get = vi.fn()
vi.mock("@/lib/api", () => ({ api: { get: (...args: unknown[]) => get(...args) } }))

const TASKS = [
  { id: "t1", title: "Book the flights for the spring trip", categoryName: "Travel" },
  { id: "t2", title: "Renew the household insurance policy", categoryName: "Household" },
]

beforeEach(() => {
  vi.clearAllMocks()
  get.mockResolvedValue({ data: { items: TASKS } })
  useAuthStore.setState({ isAuthenticated: true })
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as typeof window.matchMedia
})

afterEach(() => {
  useAuthStore.setState({ isAuthenticated: false })
  document.body.style.overflow = ""
})

const openPalette = async () => {
  render(<CommandPalette />)
  await userEvent.keyboard("{Control>}k{/Control}")
  return screen.findByRole("dialog", { name: "Command palette" })
}

describe("CommandPalette", () => {
  it("renders nothing for a signed-out visitor", async () => {
    useAuthStore.setState({ isAuthenticated: false })
    render(<CommandPalette />)
    await userEvent.keyboard("{Control>}k{/Control}")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens on Ctrl+K and puts focus in the search field", async () => {
    await openPalette()
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus())
  })

  it("closes on Escape", async () => {
    await openPalette()
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("follows the combobox pattern: focus stays in the field, selection moves", async () => {
    // Arrow keys must not move DOM focus out of the input, or typing stops working
    // mid-search. `aria-activedescendant` is what announces the highlighted row.
    await openPalette()
    const input = await screen.findByRole("combobox")
    const first = input.getAttribute("aria-activedescendant")
    await userEvent.keyboard("{ArrowDown}")
    expect(input).toHaveFocus()
    expect(input.getAttribute("aria-activedescendant")).not.toBe(first)
  })

  it("finds a task by a subsequence of its title", async () => {
    await openPalette()
    await waitFor(() => expect(get).toHaveBeenCalled())
    await userEvent.type(screen.getByRole("combobox"), "bfl")
    await waitFor(() => {
      const options = screen.getAllByRole("option")
      expect(options[0]).toHaveTextContent("Book the flights")
    })
  })

  it("opens the selected task's branch on Enter", async () => {
    await openPalette()
    await waitFor(() => expect(get).toHaveBeenCalled())
    await userEvent.type(screen.getByRole("combobox"), "insurance")
    await waitFor(() => expect(screen.getAllByRole("option")[0]).toHaveTextContent("insurance"))
    await userEvent.keyboard("{Enter}")
    expect(push).toHaveBeenCalledWith("/branch/t2")
  })

  it("says so when nothing matches", async () => {
    await openPalette()
    await userEvent.type(screen.getByRole("combobox"), "zzzzzzz")
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument()
  })

  it("still navigates when the task fetch fails", async () => {
    // A palette that cannot reach the API is still a navigation palette.
    get.mockRejectedValueOnce(new Error("offline"))
    await openPalette()
    await userEvent.type(screen.getByRole("combobox"), "categor")
    await waitFor(() => expect(screen.getAllByRole("option")[0]).toHaveTextContent("Categories"))
    await userEvent.keyboard("{Enter}")
    expect(push).toHaveBeenCalledWith("/categories")
  })

  it("deduplicates tasks that arrive twice", async () => {
    get.mockResolvedValue({ data: { items: [...TASKS, TASKS[0]] } })
    await openPalette()
    await waitFor(() => expect(get).toHaveBeenCalled())
    await userEvent.type(screen.getByRole("combobox"), "flights")
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1))
  })

  it("locks page scroll while open", async () => {
    await openPalette()
    expect(document.body.style.overflow).toBe("hidden")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(document.body.style.overflow).toBe(""))
  })
})
