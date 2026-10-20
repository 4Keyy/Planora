import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { EditTodoModal } from "@/components/todos/edit-todo-modal"
import { useAuthStore } from "@/store/auth"
import type { Category } from "@/types/category"
import { EMPTY_GUID, TodoPriority, TodoStatus, type Todo, type UpdateTodoPayload } from "@/types/todo"

// The branch is a feed of its own; here it only has to hand the modal a note to save.
const branch = vi.hoisted(() => ({ onSaveDescription: undefined as ((text: string) => Promise<void>) | undefined }))
vi.mock("@/components/todos/edit-todo-modal/branch-feed", () => ({
  BranchFeed: (props: { onSaveDescription?: (text: string) => Promise<void> }) => {
    branch.onSaveDescription = props.onSaveDescription
    return <div data-testid="branch-feed" />
  },
}))

vi.mock("@/hooks/use-friends", () => ({ useFriends: () => [] }))

vi.mock("@/lib/api", () => ({
  api: {
    post: vi.fn(),
    get: vi.fn().mockResolvedValue({ data: { items: [], totalCount: 0 } }),
    patch: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
  parseApiResponse: (response: unknown) => response,
}))

const categories: Category[] = [
  { id: "cat-1", name: "Work", color: "#111827", icon: "Briefcase" },
  { id: "cat-2", name: "Home", color: "#2563eb", icon: "Home" },
]

const ownerTodo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "todo-1",
  userId: "owner-1",
  title: "Plan the week",
  description: "Agenda and owners",
  status: TodoStatus.Pending,
  categoryId: "cat-1",
  categoryName: "Work",
  categoryColor: "#111827",
  categoryIcon: "Briefcase",
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
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  sharedWithUserIds: [],
  ...overrides,
})

function renderModal(todo: Todo, onSave: (payload: UpdateTodoPayload) => Promise<void>) {
  return render(
    <EditTodoModal
      todo={todo}
      categories={categories}
      onClose={vi.fn()}
      onSave={onSave}
      onSaveViewerPreference={vi.fn()}
      onCreateCategory={vi.fn().mockResolvedValue(undefined)}
      onDeleteCategory={vi.fn()}
    />,
  )
}

describe("EditTodoModal clearing a category and the Author's Note", () => {
  beforeEach(() => {
    branch.onSaveDescription = undefined
    useAuthStore.setState({
      user: { userId: "owner-1", email: "owner@example.com", firstName: "Owner", lastName: "User" },
      accessToken: "token",
      isAuthenticated: true,
      hasHydrated: true,
      hasRestoredSession: true,
      roles: ["User"],
    })
  })

  it("sends the empty GUID, the server's clear value, when the owner picks No category", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<(payload: UpdateTodoPayload) => Promise<void>>().mockResolvedValue(undefined)
    renderModal(ownerTodo(), onSave)

    await user.click(screen.getByRole("button", { name: "Work" }))
    await user.click(await screen.findByRole("button", { name: "No category" }))

    await waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 2000 })
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: EMPTY_GUID }))
  })

  it("does not save an uncategorised task just because it was opened", async () => {
    const onSave = vi.fn<(payload: UpdateTodoPayload) => Promise<void>>().mockResolvedValue(undefined)
    renderModal(ownerTodo({ categoryId: null, categoryName: null, categoryColor: null, categoryIcon: null }), onSave)

    // Longer than the autosave debounce (600ms).
    await act(() => new Promise((resolve) => setTimeout(resolve, 900)))
    expect(onSave).not.toHaveBeenCalled()
  })

  it("clears the Author's Note with an empty string, not the server's 'unchanged' null", async () => {
    const onSave = vi.fn<(payload: UpdateTodoPayload) => Promise<void>>().mockResolvedValue(undefined)
    renderModal(ownerTodo(), onSave)

    expect(branch.onSaveDescription).toBeTypeOf("function")
    await act(() => branch.onSaveDescription!("   "))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ description: "" }))
  })

  it("still saves a written note trimmed", async () => {
    const onSave = vi.fn<(payload: UpdateTodoPayload) => Promise<void>>().mockResolvedValue(undefined)
    renderModal(ownerTodo(), onSave)

    await act(() => branch.onSaveDescription!("  New agenda  "))

    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ description: "New agenda" }))
  })
})
