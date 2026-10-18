import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CategoryDialog } from "@/components/categories/category-dialog"
import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { readFilter } from "@/utils/category-filter"
import type { Category } from "@/types/category"
import type { Todo } from "@/types/todo"

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}))

const home: Category = { id: "home", name: "Home", description: "The flat", color: "#0EA5E9", icon: "Home" }

function todo(id: string, extra: Partial<Todo> = {}): Todo {
  return {
    id, userId: "owner", title: `Task ${id}`, status: "Todo", priority: "High", isPublic: false,
    isCompleted: false, tags: [], createdAt: "2026-10-01T00:00:00Z", categoryId: "home", ...extra,
  }
}

/** Answers the two list reads the edit sheet makes: open tasks, and the done count. */
function serveTasks(open: Todo[], doneTotal = 0) {
  vi.mocked(api.get).mockImplementation(async (_url, config) => {
    const params = (config as { params?: { isCompleted?: boolean } } | undefined)?.params
    return params?.isCompleted
      ? { data: { items: [], totalCount: doneTotal } }
      : { data: { items: open, totalCount: open.length } }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  useAuthStore.setState({ user: { userId: "owner", email: "o@example.com", firstName: "O", lastName: "U" } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("the new-category sheet", () => {
  const renderCreate = (onSave = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) => {
    render(<CategoryDialog mode="create" open onClose={onClose} onSave={onSave} />)
    return { onSave, onClose, name: screen.getByRole("textbox", { name: "Name" }) }
  }

  it("says it makes a new category, and waits for a name", () => {
    renderCreate()
    expect(screen.getByRole("dialog", { name: "New category" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create category" })).toBeDisabled()
    expect(screen.getByText("On your categories page")).toBeInTheDocument()
    // Nothing lights up by itself: the name is not focused on opening.
    expect(screen.getByRole("textbox", { name: "Name" })).not.toHaveFocus()
  })

  it("creates on Enter with a real colour, the trimmed name and description, then closes", async () => {
    const { onSave, onClose, name } = renderCreate()
    fireEvent.change(name, { target: { value: "  Garden  " } })
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: " Beds " } })
    expect(screen.getByRole("button", { name: "Create category" })).toBeEnabled()
    fireEvent.keyDown(name, { key: "Enter" })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledWith({ name: "Garden", description: "Beds", color: "#0ea5e9", icon: null })
  })

  it("keeps the draft and says so when creating fails", async () => {
    const { onClose, name } = renderCreate(vi.fn().mockRejectedValue(new Error("nope")))
    fireEvent.change(name, { target: { value: "Garden" } })
    fireEvent.click(screen.getByRole("button", { name: "Create category" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't create the category. Try again.")
    expect(onClose).not.toHaveBeenCalled()
    expect(name).toHaveValue("Garden")
  })

  it("sends the first key typed from nowhere into the name", () => {
    const { name } = renderCreate()
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(document.body, { key: "g" })
    expect(name).toHaveFocus()
    // A shortcut chord is not typing.
    name.blur()
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true })
    expect(name).not.toHaveFocus()
  })

  it("picks a colour and an icon, and folds the wheel out for a custom colour", () => {
    const { onSave, name } = renderCreate()
    const green = screen.getByRole("radio", { name: "Colour #10b981" })
    fireEvent.click(green)
    expect(green).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Colour #0ea5e9" })).toHaveAttribute("aria-checked", "false")

    const custom = screen.getByRole("radio", { name: "Custom colour" })
    expect(custom).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(custom)
    expect(custom).toHaveAttribute("aria-expanded", "true")

    fireEvent.click(screen.getByRole("radio", { name: "Home icon" }))
    expect(screen.getByRole("radio", { name: "Home icon" })).toHaveAttribute("aria-checked", "true")
    fireEvent.change(name, { target: { value: "Flat" } })
    fireEvent.click(screen.getByRole("button", { name: "Create category" }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ color: "#10b981", icon: "Home" }))
  })
})

describe("the existing-category sheet", () => {
  const renderEdit = (category: Category = home, extra: Partial<Parameters<typeof CategoryDialog>[0]> = {}) => {
    const props = {
      onClose: vi.fn(),
      onSave: vi.fn().mockResolvedValue(undefined),
      onDelete: vi.fn(),
      onOpenCount: vi.fn(),
      ...extra,
    }
    const view = render(<CategoryDialog mode="edit" open category={category} {...props} />)
    return { ...props, ...view }
  }

  it("shows the category and its open tasks, and reports the count", async () => {
    serveTasks([todo("a", { dueDate: "2026-11-08T00:00:00Z" }), todo("b", { hidden: true, title: "Hidden task" })], 3)
    const { onOpenCount } = renderEdit()
    expect(screen.getByRole("dialog", { name: "Category Home" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Home")
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("The flat")

    expect(await screen.findByText("Task a")).toBeInTheDocument()
    expect(screen.getByText("Hidden task")).toBeInTheDocument()
    expect(screen.getByText("2 open · 3 done")).toBeInTheDocument()
    expect(screen.getByText("Nov 8")).toBeInTheDocument()
    expect(onOpenCount).toHaveBeenCalledWith("home", 2)
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      "/todos/api/v1/todos",
      expect.objectContaining({ params: expect.objectContaining({ categoryId: "home", isCompleted: false }) }),
    )
  })

  it("opens a task's branch from its row", async () => {
    serveTasks([todo("a")])
    const { onClose } = renderEdit()
    fireEvent.click(await screen.findByRole("button", { name: /Task a/ }))
    expect(onClose).toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith("/branch/a")
  })

  it("shows the category's tasks in Tasks by setting the Tasks filter to it", async () => {
    serveTasks([])
    renderEdit()
    fireEvent.click(screen.getByRole("button", { name: /Show in Tasks/ }))
    expect(readFilter("owner")).toEqual(["home"])
    expect(router.push).toHaveBeenCalledWith("/tasks")
  })

  it("says when nothing is open, and when everything is done", async () => {
    serveTasks([], 0)
    const { unmount } = renderEdit()
    expect(await screen.findByText("Nothing open here")).toBeInTheDocument()
    expect(screen.getByText(/Put a task in this category/)).toBeInTheDocument()
    unmount()

    serveTasks([], 4)
    renderEdit()
    expect(await screen.findByText("Every task in this category is done.")).toBeInTheDocument()
  })

  it("offers to try again when the tasks cannot be read", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("offline"))
    renderEdit()
    expect(await screen.findByText("Couldn’t load the tasks.")).toBeInTheDocument()
    serveTasks([todo("a")])
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }))
    expect(await screen.findByText("Task a")).toBeInTheDocument()
  })

  it("deletes through the page's confirmation", () => {
    serveTasks([])
    const { onDelete } = renderEdit()
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it("autosaves a colourless category without inventing a colour", async () => {
    serveTasks([])
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderEdit({ ...home, color: null }, { onSave })
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Flat" } })
    await waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 3000 })
    expect(onSave).toHaveBeenLastCalledWith({ name: "Flat", description: "The flat", color: null, icon: "Home" })
  })

  it("asks for a name instead of saving an empty one", async () => {
    serveTasks([])
    renderEdit()
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "  " } })
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name to save your changes.")
  })

  it("keeps showing the category while it folds away", async () => {
    serveTasks([todo("a")])
    const props = { onClose: vi.fn(), onSave: vi.fn().mockResolvedValue(undefined) }
    const { rerender } = render(<CategoryDialog mode="edit" open category={home} {...props} />)
    await screen.findByText("Task a")
    act(() => rerender(<CategoryDialog mode="edit" open={false} category={null} {...props} />))
    const dialog = screen.queryByRole("dialog", { hidden: true })
    if (dialog) expect(within(dialog).getByText("Task a")).toBeInTheDocument()
  })
})
