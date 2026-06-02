import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SubtasksSection } from "@/components/todos/edit-todo-modal/subtasks-section"
import type { Todo } from "@/types/todo"
import { createSubtask, fetchSubtasks, updateSubtask, deleteSubtask } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  fetchSubtasks: vi.fn(),
  createSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
  getApiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}))

const sub = (overrides: Partial<Todo> = {}): Todo => ({
  id: "s1",
  userId: "owner-1",
  title: "Write the intro",
  status: "Todo",
  priority: "Medium",
  isPublic: false,
  isCompleted: false,
  tags: [],
  createdAt: "2026-06-01T10:00:00.000Z",
  parentTodoId: "p1",
  ...overrides,
})

describe("SubtasksSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchSubtasks).mockResolvedValue([])
  })
  afterEach(() => vi.restoreAllMocks())

  it("renders fetched subtasks with a completed/total count", async () => {
    vi.mocked(fetchSubtasks).mockResolvedValue([
      sub({ id: "s1", title: "Alpha", status: "Todo" }),
      sub({ id: "s2", title: "Beta", status: "Done", isCompleted: true }),
    ])

    render(<SubtasksSection todoId="p1" isOwner />)

    expect(await screen.findByText("Alpha")).toBeInTheDocument()
    expect(screen.getByText("Beta")).toBeInTheDocument()
    expect(screen.getByText("1/2")).toBeInTheDocument() // one of two done
  })

  it("renders nothing for a non-owner viewer when there are no subtasks", async () => {
    vi.mocked(fetchSubtasks).mockResolvedValue([])
    const { container } = render(<SubtasksSection todoId="p1" isOwner={false} />)
    await waitFor(() => expect(fetchSubtasks).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("lets the owner create a subtask with a chosen priority", async () => {
    const user = userEvent.setup()
    vi.mocked(fetchSubtasks).mockResolvedValue([])
    vi.mocked(createSubtask).mockResolvedValue(sub({ id: "new", title: "Draft outline", priority: "Urgent" }))

    render(<SubtasksSection todoId="p1" isOwner />)
    await waitFor(() => expect(fetchSubtasks).toHaveBeenCalled())

    await user.click(screen.getByRole("button", { name: /add/i }))
    const input = await screen.findByPlaceholderText("Subtask title…")
    fireEvent.change(input, { target: { value: "Draft outline" } })
    // pick Urgent priority
    await user.click(screen.getByTitle("Urgent"))
    await user.click(screen.getByRole("button", { name: "Add subtask" }))

    await waitFor(() => expect(createSubtask).toHaveBeenCalledWith("p1", { title: "Draft outline", priority: 5 }))
    expect(await screen.findByText("Draft outline")).toBeInTheDocument()
  })

  it("completes a subtask optimistically and persists status=done", async () => {
    const user = userEvent.setup()
    vi.mocked(fetchSubtasks).mockResolvedValue([sub({ id: "s1", title: "Alpha", status: "Todo" })])
    vi.mocked(updateSubtask).mockResolvedValue(sub({ id: "s1", status: "Done", isCompleted: true }))

    render(<SubtasksSection todoId="p1" isOwner />)
    await screen.findByText("Alpha")

    await user.click(screen.getByRole("button", { name: "Complete subtask" }))

    await waitFor(() => expect(updateSubtask).toHaveBeenCalledWith("s1", { status: "done" }))
  })

  it("deletes a subtask for the owner", async () => {
    vi.mocked(fetchSubtasks).mockResolvedValue([sub({ id: "s1", title: "Alpha" })])
    vi.mocked(deleteSubtask).mockResolvedValue(undefined)

    render(<SubtasksSection todoId="p1" isOwner />)
    await screen.findByText("Alpha")

    // Owner row actions are revealed on hover (pointer-events:none at rest); fireEvent
    // dispatches the click directly so we exercise the handler.
    fireEvent.click(screen.getByRole("button", { name: "Delete subtask" }))

    await waitFor(() => expect(deleteSubtask).toHaveBeenCalledWith("s1"))
  })
})
