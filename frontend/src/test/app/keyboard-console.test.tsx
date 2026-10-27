import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { HTMLAttributes } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { KeyboardConsole } from "@/app/_landing/keyboard-console"
import { api } from "@/lib/api"
import { DEMO_USER } from "@/lib/demo/state"
import { useToastStore } from "@/store/toast"
import { TodoPriority, TodoStatus, type Todo, type UpdateTodoPayload } from "@/types/todo"

// The landing's keyboard block runs the product's own list model over the sandbox's data: the
// keys on its legend move, open, complete, prioritise and delete, through the same requests
// `/tasks` sends. Cards and the editor are stand-ins; the list navigation is the real one.
vi.mock("@/components/todos/todo-card", () => ({
  TodoCard: ({ todo, rowProps, onComplete }: { todo: Todo; rowProps?: HTMLAttributes<HTMLElement>; onComplete: () => void }) => (
    <article aria-label={todo.title} data-priority={todo.priority} {...rowProps}>
      <button type="button" onClick={onComplete}>Complete</button>
    </article>
  ),
}))

type EditorProps = { todo: Todo; openInTitleEdit?: boolean; onClose: () => void; onSave: (payload: UpdateTodoPayload) => Promise<void> }
const editor = vi.hoisted(() => ({ props: undefined as EditorProps | undefined }))
vi.mock("@/components/todos/edit-todo-modal/lazy", () => ({
  LazyEditTodoModal: (props: EditorProps) => {
    editor.props = props
    return (
      <section role="dialog" aria-label={`Editing ${props.todo.title}`} data-title-edit={String(Boolean(props.openInTitleEdit))}>
        <button type="button" onClick={props.onClose}>Close</button>
      </section>
    )
  },
}))
vi.mock("@/app/_landing/demo-sandbox", () => ({ SandboxNotice: () => <p>Sandbox</p> }))
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
  parseApiResponse: (data: unknown) => data,
}))

const task = (overrides: Partial<Todo> = {}): Todo => ({
  id: "d-1",
  userId: DEMO_USER.userId,
  title: "Plan Mira's surprise party",
  description: null,
  status: TodoStatus.Pending,
  categoryId: null,
  dueDate: null,
  expectedDate: null,
  actualDate: null,
  priority: TodoPriority.Medium,
  isPublic: false,
  isCompleted: false,
  hidden: false,
  completedAt: null,
  isOnTime: null,
  delay: null,
  tags: [],
  createdAt: "2026-10-20T09:00:00Z",
  updatedAt: null,
  sharedWithUserIds: [],
  ...overrides,
})

let list: Todo[] = []
let failing = false

beforeEach(() => {
  list = [task(), task({ id: "d-2", title: "Book the venue" }), task({ id: "d-3", title: "Victoria's list", userId: "friend" })]
  failing = false
  editor.props = undefined
  useToastStore.setState({ toasts: [] })
  vi.mocked(api.get).mockReset().mockImplementation(async (url) => {
    if (failing) throw new Error("Sandbox not installed")
    return url === "/categories/api/v1/categories" ? { data: [] } : { data: { items: list, totalCount: list.length } }
  })
  vi.mocked(api.put).mockReset().mockResolvedValue({ data: task() })
  vi.mocked(api.delete).mockReset().mockResolvedValue({ data: null })
})

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title)
const loaded = () => screen.findByRole("article", { name: "Plan Mira's surprise party" })

describe("Landing keyboard console", () => {
  it("lists the sandbox's open tasks and the keys bound on the page", async () => {
    render(<KeyboardConsole />)

    await loaded()
    expect(screen.getAllByRole("article")).toHaveLength(3)
    expect(api.get).toHaveBeenCalledWith("/todos/api/v1/todos", { params: { isCompleted: false } })
    expect(screen.getByText("Delete, with five seconds to undo")).toBeInTheDocument()
  })

  it("says the sandbox did not start rather than showing an empty product", async () => {
    failing = true
    render(<KeyboardConsole />)

    expect(await screen.findByText("The sandbox did not start")).toBeInTheDocument()
    expect(screen.queryByRole("article")).not.toBeInTheDocument()
  })

  it("completes a task only once the server agrees, and says so when it does not", async () => {
    const user = userEvent.setup()
    render(<KeyboardConsole />)

    await user.click(within(await loaded()).getByRole("button", { name: "Complete" }))
    await waitFor(() => expect(screen.queryByRole("article", { name: "Plan Mira's surprise party" })).not.toBeInTheDocument())
    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/d-1", { status: "done" })
    expect(toastTitles()).toContain("Task completed")

    vi.mocked(api.put).mockRejectedValueOnce(new Error("Conflict"))
    await user.click(within(screen.getByRole("article", { name: "Book the venue" })).getByRole("button", { name: "Complete" }))
    await waitFor(() => expect(toastTitles()).toContain("Couldn't update task"))
    expect(screen.getByRole("article", { name: "Book the venue" })).toBeInTheDocument()
  })

  it("moves with J and opens the branch with Enter, or the title with E", async () => {
    const user = userEvent.setup()
    render(<KeyboardConsole />)
    await loaded()

    await user.keyboard("j")
    await user.keyboard("{Enter}")
    expect(await screen.findByRole("dialog", { name: "Editing Plan Mira's surprise party" })).toHaveAttribute("data-title-edit", "false")
    await user.click(screen.getByRole("button", { name: "Close" }))

    await user.keyboard("j")
    await user.keyboard("e")
    expect(await screen.findByRole("dialog", { name: "Editing Book the venue" })).toHaveAttribute("data-title-edit", "true")
  })

  it("sets the priority of the viewer's own task from the cursor, and of no one else's", async () => {
    const user = userEvent.setup()
    vi.mocked(api.put).mockImplementation(async (_url, body) => ({ data: task({ priority: (body as { priority: number }).priority === 5 ? TodoPriority.Urgent : TodoPriority.Medium }) }))
    render(<KeyboardConsole />)
    await loaded()

    await user.keyboard("j")
    await user.keyboard("5")
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/d-1", { priority: 5 }))

    await user.keyboard("jj")
    await user.keyboard("3")
    expect(api.put).not.toHaveBeenCalledWith("/todos/api/v1/todos/d-3", expect.anything())
  })

  it("deletes with Delete behind the undo window, which Undo closes without a request", async () => {
    const user = userEvent.setup()
    render(<KeyboardConsole />)
    await loaded()

    await user.keyboard("j")
    await user.keyboard("{Delete}")
    await waitFor(() => expect(screen.queryByRole("article", { name: "Plan Mira's surprise party" })).not.toBeInTheDocument())

    const offer = useToastStore.getState().toasts.find((t) => t.title === "Task deleted")
    act(() => offer!.action!.onClick())
    expect(await loaded()).toBeInTheDocument()
    expect(api.delete).not.toHaveBeenCalled()
  })

  it("puts a deleted task back when the server refuses it", async () => {
    const user = userEvent.setup()
    vi.mocked(api.delete).mockRejectedValue(new Error("Forbidden"))
    const { unmount } = render(<KeyboardConsole />)
    await loaded()

    await user.keyboard("j")
    await user.keyboard("{Delete}")
    unmount()

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/todos/api/v1/todos/d-1"))
    await waitFor(() => expect(toastTitles()).toContain("Couldn't delete task"))
  })

  it("saves the editor's changes and reads the sandbox again", async () => {
    const user = userEvent.setup()
    render(<KeyboardConsole />)
    await loaded()

    await user.keyboard("j")
    await user.keyboard("{Enter}")
    await screen.findByRole("dialog", { name: "Editing Plan Mira's surprise party" })
    const reads = vi.mocked(api.get).mock.calls.length
    await act(() => editor.props!.onSave({ title: "Plan the party" } as UpdateTodoPayload))

    expect(api.put).toHaveBeenCalledWith("/todos/api/v1/todos/d-1", { title: "Plan the party" })
    expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(reads)
  })

  it("says everything is done once the list is empty", async () => {
    list = []
    render(<KeyboardConsole />)

    expect(await screen.findByText("Everything is done")).toBeInTheDocument()
  })
})
