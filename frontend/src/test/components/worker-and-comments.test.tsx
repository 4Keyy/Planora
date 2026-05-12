import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WorkerJoinButton } from "@/components/todos/worker-join-button"
import { TaskComments } from "@/components/todos/task-comments"
import type { TodoComment } from "@/types/todo"

// ── API mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/api", () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
  fetchComments: vi.fn(),
  addComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  getApiErrorMessage: (e: unknown) =>
    e instanceof Error ? e.message : "Something went wrong",
  parseApiResponse: (r: unknown) => r,
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

const baseComment = (overrides: Partial<TodoComment> = {}): TodoComment => ({
  id: "c1",
  todoItemId: "todo-1",
  authorId: "user-1",
  authorName: "Alice",
  content: "First comment",
  createdAt: new Date().toISOString(),
  updatedAt: null,
  isOwn: true,
  isEdited: false,
  ...overrides,
})

// ── WorkerJoinButton ───────────────────────────────────────────────────────────

describe("WorkerJoinButton", () => {
  const onJoin = vi.fn()
  const onLeave = vi.fn()
  const onControlHoverChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    onJoin.mockResolvedValue(undefined)
    onLeave.mockResolvedValue(undefined)
  })

  it("returns null when isOwner=true", () => {
    const { container } = render(
      <WorkerJoinButton
        isOwner={true}
        isWorking={false}
        isFull={false}
        onJoin={onJoin}
        onLeave={onLeave}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("shows In-work strip and leave button when isWorking=true", () => {
    render(
      <WorkerJoinButton
        isOwner={false}
        isWorking={true}
        isFull={false}
        onJoin={onJoin}
        onLeave={onLeave}
        onControlHoverChange={onControlHoverChange}
      />,
    )
    expect(screen.getByText("In work")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "leave" })).toBeInTheDocument()
  })

  it("calls onLeave when leave button is clicked", async () => {
    render(
      <WorkerJoinButton
        isOwner={false}
        isWorking={true}
        isFull={false}
        onJoin={onJoin}
        onLeave={onLeave}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "leave" }))
    await waitFor(() => expect(onLeave).toHaveBeenCalledOnce())
  })

  it("shows pending state while leaving (leave button disabled)", async () => {
    let resolve!: () => void
    onLeave.mockReturnValueOnce(new Promise<void>((r) => { resolve = r }))

    render(
      <WorkerJoinButton
        isOwner={false}
        isWorking={true}
        isFull={false}
        onJoin={onJoin}
        onLeave={onLeave}
      />,
    )
    const leaveBtn = screen.getByRole("button", { name: "leave" })
    fireEvent.click(leaveBtn)
    await waitFor(() => expect(screen.getByRole("button", { name: "···" })).toBeDisabled())
    resolve()
    await waitFor(() => expect(screen.getByRole("button", { name: "leave" })).not.toBeDisabled())
  })

  it("ignores a second click while pending", async () => {
    let resolve!: () => void
    onLeave.mockReturnValueOnce(new Promise<void>((r) => { resolve = r }))

    render(
      <WorkerJoinButton
        isOwner={false}
        isWorking={true}
        isFull={false}
        onJoin={onJoin}
        onLeave={onLeave}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "leave" }))
    // Second click while pending — should be no-op
    await waitFor(() => expect(screen.getByRole("button", { name: "···" })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "···" }))
    resolve()
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1))
  })

  it("shows lock icon and Full text when isFull=true", () => {
    const { container } = render(
      <WorkerJoinButton
        isOwner={false}
        isWorking={false}
        isFull={true}
        onJoin={onJoin}
        onLeave={onLeave}
      />,
    )
    expect(screen.getByText("Full")).toBeInTheDocument()
    expect(container.querySelector(".lucide-lock")).toBeInTheDocument()
  })

  it("shows Take-it button when not owner/working/full", () => {
    render(
      <WorkerJoinButton
        isOwner={false}
        isWorking={false}
        isFull={false}
        onJoin={onJoin}
        onLeave={onLeave}
        onControlHoverChange={onControlHoverChange}
      />,
    )
    expect(screen.getByText("Take it")).toBeInTheDocument()
    expect(screen.getByText("→")).toBeInTheDocument()
  })

  it("calls onJoin when Take-it button is clicked", async () => {
    render(
      <WorkerJoinButton
        isOwner={false}
        isWorking={false}
        isFull={false}
        onJoin={onJoin}
        onLeave={onLeave}
      />,
    )
    fireEvent.click(screen.getByText("Take it").closest("button")!)
    await waitFor(() => expect(onJoin).toHaveBeenCalledOnce())
  })

  it("shows Joining··· and hides arrow while join is pending", async () => {
    let resolve!: () => void
    onJoin.mockReturnValueOnce(new Promise<void>((r) => { resolve = r }))

    render(
      <WorkerJoinButton
        isOwner={false}
        isWorking={false}
        isFull={false}
        onJoin={onJoin}
        onLeave={onLeave}
      />,
    )
    fireEvent.click(screen.getByText("Take it").closest("button")!)
    await waitFor(() => expect(screen.getByText("Joining···")).toBeInTheDocument())
    expect(screen.queryByText("→")).toBeNull()
    resolve()
    await waitFor(() => expect(screen.getByText("Take it")).toBeInTheDocument())
    expect(screen.getByText("→")).toBeInTheDocument()
  })

  it("fires onControlHoverChange on mouse enter/leave (isWorking branch)", () => {
    render(
      <WorkerJoinButton
        isOwner={false}
        isWorking={true}
        isFull={false}
        onJoin={onJoin}
        onLeave={onLeave}
        onControlHoverChange={onControlHoverChange}
      />,
    )
    const strip = screen.getByText("In work").closest("div")!
    fireEvent.mouseEnter(strip)
    expect(onControlHoverChange).toHaveBeenCalledWith(true)
    fireEvent.mouseLeave(strip)
    expect(onControlHoverChange).toHaveBeenCalledWith(false)
  })

  it("fires onControlHoverChange on mouse enter/leave (take-it branch)", () => {
    render(
      <WorkerJoinButton
        isOwner={false}
        isWorking={false}
        isFull={false}
        onJoin={onJoin}
        onLeave={onLeave}
        onControlHoverChange={onControlHoverChange}
      />,
    )
    const btn = screen.getByText("Take it").closest("button")!
    fireEvent.mouseEnter(btn)
    expect(onControlHoverChange).toHaveBeenCalledWith(true)
    fireEvent.mouseLeave(btn)
    expect(onControlHoverChange).toHaveBeenCalledWith(false)
  })
})

// ── TaskComments ───────────────────────────────────────────────────────────────

import { fetchComments, addComment, updateComment, deleteComment } from "@/lib/api"

const mockFetch = fetchComments as ReturnType<typeof vi.fn>
const mockAdd = addComment as ReturnType<typeof vi.fn>
const mockUpdate = updateComment as ReturnType<typeof vi.fn>
const mockDelete = deleteComment as ReturnType<typeof vi.fn>

describe("TaskComments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ items: [], totalCount: 0 })
  })

  it("shows loading state then empty message", async () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {})) // never resolves initially
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    expect(screen.getByText("Loading…")).toBeInTheDocument()
  })

  it("shows 'No comments yet' when list is empty", async () => {
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByText("No comments yet.")).toBeInTheDocument())
  })

  it("renders comments from the API", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment()],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByText("First comment")).toBeInTheDocument())
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })

  it("shows 'edited' label when comment isEdited=true", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ isEdited: true })],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByText(/· edited/)).toBeInTheDocument())
  })

  it("shows comment count in header when > 0", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment()],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByText(/Comments · 1/)).toBeInTheDocument())
  })

  it("hides input area when canComment=false", async () => {
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={false} />)
    await waitFor(() => expect(screen.queryByPlaceholderText(/Add a comment/)).toBeNull())
  })

  it("adds a comment on button click", async () => {
    const newComment = baseComment({ id: "c2", content: "Hello world", isOwn: true })
    mockAdd.mockResolvedValueOnce(newComment)

    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByPlaceholderText(/Add a comment/)).toBeInTheDocument())

    const textarea = screen.getByPlaceholderText(/Add a comment/)
    await userEvent.type(textarea, "Hello world")
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith("todo-1", "Hello world"))
    await waitFor(() => expect(screen.getByText("Hello world")).toBeInTheDocument())
  })

  it("adds a comment via Ctrl+Enter keyboard shortcut", async () => {
    const newComment = baseComment({ id: "c3", content: "Keyboard", isOwn: true })
    mockAdd.mockResolvedValueOnce(newComment)

    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByPlaceholderText(/Add a comment/)).toBeInTheDocument())

    const textarea = screen.getByPlaceholderText(/Add a comment/)
    await userEvent.type(textarea, "Keyboard")
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true })

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith("todo-1", "Keyboard"))
  })

  it("does not submit empty content", async () => {
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled())
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it("shows error message when addComment fails", async () => {
    mockAdd.mockRejectedValueOnce(new Error("Network error"))

    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByPlaceholderText(/Add a comment/)).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/Add a comment/), "test")
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument())
  })

  it("shows edit/delete controls for own comments (isOwn=true)", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ isOwn: true })],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByText("First comment")).toBeInTheDocument())
    expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Delete/ })).toBeInTheDocument()
  })

  it("shows only delete control for non-own comment when user isOwner", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ isOwn: false })],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={true} canComment={false} />)
    await waitFor(() => expect(screen.getByText("First comment")).toBeInTheDocument())
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull()
    expect(screen.getByRole("button", { name: /Delete/ })).toBeInTheDocument()
  })

  it("enters edit mode and saves updated comment", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ isOwn: true })],
      totalCount: 1,
    })
    const updated = baseComment({ content: "Updated content", isEdited: true })
    mockUpdate.mockResolvedValueOnce(updated)

    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }))
    const editArea = screen.getAllByRole("textbox")[0]
    await userEvent.clear(editArea)
    await userEvent.type(editArea, "Updated content")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("todo-1", "c1", "Updated content"))
    await waitFor(() => expect(screen.getByText("Updated content")).toBeInTheDocument())
  })

  it("cancels edit on Cancel button click", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ isOwn: true })],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }))
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.getByText("First comment")).toBeInTheDocument())
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull()
  })

  it("cancels edit on Escape key", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ isOwn: true })],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }))
    const editArea = screen.getAllByRole("textbox")[0]
    fireEvent.keyDown(editArea, { key: "Escape" })

    await waitFor(() => expect(screen.getByText("First comment")).toBeInTheDocument())
  })

  it("saves edit via Ctrl+Enter keyboard shortcut", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ isOwn: true })],
      totalCount: 1,
    })
    const updated = baseComment({ content: "KB save", isEdited: true })
    mockUpdate.mockResolvedValueOnce(updated)

    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }))
    const editArea = screen.getAllByRole("textbox")[0]
    await userEvent.clear(editArea)
    await userEvent.type(editArea, "KB save")
    fireEvent.keyDown(editArea, { key: "Enter", ctrlKey: true })

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("todo-1", "c1", "KB save"))
  })

  it("shows error when updateComment fails", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ isOwn: true })],
      totalCount: 1,
    })
    mockUpdate.mockRejectedValueOnce(new Error("Update failed"))

    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }))
    const editArea = screen.getAllByRole("textbox")[0]
    await userEvent.clear(editArea)
    await userEvent.type(editArea, "something")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(screen.getByText("Update failed")).toBeInTheDocument())
  })

  it("deletes a comment and removes it from the list", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment()],
      totalCount: 1,
    })
    mockDelete.mockResolvedValueOnce(undefined)

    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByText("First comment")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("todo-1", "c1"))
    await waitFor(() => expect(screen.queryByText("First comment")).toBeNull())
  })

  it("shows error when deleteComment fails", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment()],
      totalCount: 1,
    })
    mockDelete.mockRejectedValueOnce(new Error("Delete failed"))

    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByRole("button", { name: /Delete/ })).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }))
    await waitFor(() => expect(screen.getByText("Delete failed")).toBeInTheDocument())
    expect(screen.getByText("First comment")).toBeInTheDocument()
  })

  it("shows Load-earlier button and fetches next page when hasMore", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [baseComment()],
      totalCount: 5,
    })
    const page2 = baseComment({ id: "c2", content: "Earlier comment" })
    mockFetch.mockResolvedValueOnce({ items: [page2], totalCount: 5 })

    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Load earlier comments" })).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole("button", { name: "Load earlier comments" }))
    await waitFor(() => expect(screen.getByText("Earlier comment")).toBeInTheDocument())
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("displays 'X m ago' for comments a few minutes old", async () => {
    const minutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ createdAt: minutesAgo })],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByText("5m ago")).toBeInTheDocument())
  })

  it("displays 'X h ago' for comments a few hours old", async () => {
    const hoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString()
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ createdAt: hoursAgo })],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByText("3h ago")).toBeInTheDocument())
  })

  it("displays locale date for comments older than 24 hours", async () => {
    const daysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ createdAt: daysAgo })],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    const expected = new Date(daysAgo).toLocaleDateString()
    await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument())
  })

  it("displays 'just now' for very recent comments", async () => {
    const justNow = new Date().toISOString()
    mockFetch.mockResolvedValueOnce({
      items: [baseComment({ createdAt: justNow })],
      totalCount: 1,
    })
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByText("just now")).toBeInTheDocument())
  })

  it("shows char-count warning colour above 80% of limit", async () => {
    render(<TaskComments todoId="todo-1" isOwner={false} canComment={true} />)
    await waitFor(() => expect(screen.getByPlaceholderText(/Add a comment/)).toBeInTheDocument())

    const textarea = screen.getByPlaceholderText(/Add a comment/)
    // Use fireEvent.change to avoid the slow character-by-character simulation
    fireEvent.change(textarea, { target: { value: "a".repeat(1601) } })
    const counter = screen.getByText(/\/2000/)
    expect(counter.className).toMatch(/amber/)
  })
})
