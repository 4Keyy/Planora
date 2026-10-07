import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CreateTodoPanel } from "@/components/todos/create-todo-panel"
import { TodoEditor } from "@/components/todos/edit-todo-modal/modal"
import { todoToOwnerPayload } from "@/components/todos/edit-todo-modal/utils"
import { useAuthStore } from "@/store/auth"
import type { FriendDto } from "@/types/auth"
import { TodoPriority, TodoStatus, type Todo, type UpdateTodoPayload } from "@/types/todo"
import type { UseAutosaveOptions } from "@/hooks/use-autosave"

const fixture = vi.hoisted(() => ({
  friends: [] as FriendDto[],
  ownerPayload: null as UpdateTodoPayload | null,
  baseline: null as UpdateTodoPayload | null,
}))

vi.mock("@/hooks/use-friends", () => ({ useFriends: () => fixture.friends }))
vi.mock("@/components/todos/edit-todo-modal/branch-feed", () => ({ BranchFeed: () => null }))
vi.mock("@/hooks/use-autosave", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/hooks/use-autosave")>()
  return {
    ...original,
    useAutosave<T,>(options: UseAutosaveOptions<T>) {
      const channel = original.useAutosave(options)
      if (options.enabled) fixture.ownerPayload = options.value as UpdateTodoPayload
      return {
        ...channel,
        reset(next: T) {
          if (options.enabled) fixture.baseline = next as UpdateTodoPayload
          channel.reset(next)
        },
      }
    },
  }
})

const friend = (id: string, firstName: string): FriendDto => ({
  id, firstName, lastName: "Friend", email: `${id}@example.com`,
  friendsSince: "2026-05-01T00:00:00.000Z",
})
const friends = [friend("friend-1", "Ada"), friend("friend-2", "Grace")]
const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "todo-1", userId: "owner-1", title: "Share this task", description: "A note",
  priority: TodoPriority.Medium, status: TodoStatus.Pending,
  isPublic: false, sharedWithUserIds: [], isCompleted: false,
  tags: [], createdAt: "2026-05-01T00:00:00.000Z", ...overrides,
})

beforeEach(() => {
  fixture.friends = friends
  fixture.ownerPayload = null
  fixture.baseline = null
  useAuthStore.setState({ user: { userId: "owner-1", email: "owner@example.com", firstName: "Owner", lastName: "User" } })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 200, right: 400, top: 100, bottom: 150,
    width: 200, height: 50, x: 200, y: 100, toJSON: () => ({}),
  } as DOMRect)
})
afterEach(() => vi.restoreAllMocks())

function createPanel() {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(<CreateTodoPanel isOpen onToggle={vi.fn()} categories={[]} onSubmit={onSubmit}
    onCreateCategory={vi.fn()} onDeleteCategory={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "Private task" }))
  return onSubmit
}
async function submitTask(onSubmit: ReturnType<typeof vi.fn>) {
  fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), { target: { value: "Shared task" } })
  fireEvent.click(screen.getByRole("button", { name: "Create task" }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
  return onSubmit.mock.calls[0][0] as UpdateTodoPayload
}
function editor(current: Todo, variant: "modal" | "page" = "modal") {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const view = render(<TodoEditor variant={variant} todo={current} categories={[]} onSave={onSave}
    onClose={vi.fn()} onSaveViewerPreference={vi.fn()} onCreateCategory={vi.fn()} />)
  if (variant === "modal") {
    fireEvent.click(screen.getByRole("button", { name: current.isPublic ? /all friends/i : current.sharedWithUserIds?.length ? /shared ·/i : /private/i }))
  }
  return { ...view, onSave }
}
const publicPayload = { isPublic: true, sharedWithUserIds: [], requiredWorkers: null, clearRequiredWorkers: true }
const directPayload = (ids: string[]) => ({ isPublic: false, sharedWithUserIds: ids, requiredWorkers: ids.length + 1, clearRequiredWorkers: false })

describe("Share auto-selects All friends", () => {
  it("creates an All friends task when the second current friend is picked", async () => {
    const onSubmit = createPanel()
    fireEvent.click(await screen.findByRole("checkbox", { name: "Ada Friend" }))
    expect(screen.getByRole("button", { name: "Shared with 1 friend" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Grace Friend" }))
    expect(screen.getByRole("button", { name: "Shared with all friends" })).toBeInTheDocument()
    expect(await submitTask(onSubmit)).toMatchObject({ isPublic: true, sharedWithUserIds: [], requiredWorkers: null })
  })

  it("auto-selects All friends for one friend, but a public friend click stays direct", async () => {
    fixture.friends = [friends[0]]
    const onSubmit = createPanel()
    fireEvent.click(await screen.findByRole("checkbox", { name: "Ada Friend" }))
    expect(screen.getByRole("button", { name: "Shared with all friends" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Ada Friend" }))
    expect(screen.getByRole("button", { name: "Shared with 1 friend" })).toBeInTheDocument()
    expect(await submitTask(onSubmit)).toMatchObject({ isPublic: false, sharedWithUserIds: ["friend-1"], requiredWorkers: 2 })
  })

  it("describes the current audience and keeps an empty friend list private", async () => {
    fixture.friends = []
    const onSubmit = createPanel()
    expect(await screen.findByText("Every friend you have right now")).toBeInTheDocument()
    expect(screen.getByText("No friends yet.")).toBeInTheDocument()
    expect(await submitTask(onSubmit)).toMatchObject({ isPublic: false, sharedWithUserIds: [] })
  })

  it("turns the editor's final picked friend into All friends and autosaves that payload", async () => {
    const { onSave } = editor(todo({ sharedWithUserIds: ["friend-1"] }))
    fireEvent.click(await screen.findByRole("checkbox", { name: "Grace Friend" }))
    expect(fixture.ownerPayload).toMatchObject(publicPayload)
    expect(screen.getByRole("button", { name: /all friends/i })).toBeInTheDocument()
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining(publicPayload)))
  })

  it("turns ALL into All friends through the editor callback", async () => {
    editor(todo({ sharedWithUserIds: ["friend-1"] }))
    fireEvent.click(await screen.findByRole("button", { name: "ALL" }))
    expect(fixture.ownerPayload).toMatchObject(publicPayload)
  })

  it("compares coverage of current friends even when the direct selection has stale ids", async () => {
    editor(todo({ sharedWithUserIds: ["stale-friend", "friend-1"] }))
    fireEvent.click(await screen.findByRole("checkbox", { name: "Grace Friend" }))
    expect(fixture.ownerPayload).toMatchObject(publicPayload)
  })

  it("uses the same All friends rule in the headless branch sidebar", () => {
    editor(todo({ sharedWithUserIds: ["friend-1"] }), "page")
    fireEvent.click(screen.getByRole("checkbox", { name: "Grace Friend" }))
    expect(fixture.ownerPayload).toMatchObject(publicPayload)
    expect(screen.getByText("All friends")).toBeInTheDocument()
    expect(screen.queryByText("Task access")).not.toBeInTheDocument()
  })

  it("keeps a public single-friend click as a direct share in the editor", async () => {
    fixture.friends = [friends[0]]
    editor(todo({ isPublic: true, sharedWithUserIds: ["friend-1"] }))
    fireEvent.click(await screen.findByRole("checkbox", { name: "Ada Friend" }))
    expect(fixture.ownerPayload).toMatchObject(directPayload(["friend-1"]))
  })

  it("shows NONE for All friends and clears the audience without switching mode", async () => {
    editor(todo({ isPublic: true, sharedWithUserIds: ["friend-1", "friend-2"] }))
    fireEvent.click(await screen.findByRole("button", { name: "NONE" }))
    expect(fixture.ownerPayload).toMatchObject(directPayload([]))
    expect(screen.getByRole("button", { name: /nobody yet/i })).toBeInTheDocument()
  })

  it("does not infer All friends from an empty loaded friend list", () => {
    fixture.friends = []
    editor(todo(), "page")
    fireEvent.click(screen.getByRole("button", { name: "Friends" }))
    expect(fixture.ownerPayload).toMatchObject({ isPublic: false, sharedWithUserIds: [] })
    expect(screen.getByText("Nobody yet")).toBeInTheDocument()
  })

  it("uses exactly the unchanged public owner payload as the autosave baseline", () => {
    const current = todo({
      isPublic: true, sharedWithUserIds: ["friend-1", "friend-2"],
      title: "  Shared task  ", description: "  Note  ", categoryId: "cat-1",
      dueDate: "2026-11-02T12:00:00.000Z", dueDateStart: "2026-11-01T17:00:00.000Z",
    })
    const { unmount, onSave } = editor(current, "page")
    expect(fixture.ownerPayload).toEqual(todoToOwnerPayload(current))
    expect(fixture.baseline).toEqual(fixture.ownerPayload)
    unmount()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe("todoToOwnerPayload audience parity", () => {
  it("preserves public visibility and unlimited workers while clearing the client share list", () => {
    expect(todoToOwnerPayload(todo({ isPublic: true, sharedWithUserIds: ["friend-1"] }))).toMatchObject(publicPayload)
  })
  it("preserves explicit direct sharing and its capacity", () => {
    expect(todoToOwnerPayload(todo({ sharedWithUserIds: ["friend-1"] }))).toMatchObject(directPayload(["friend-1"]))
  })
  it("keeps a private task private without workers", () => {
    expect(todoToOwnerPayload(todo())).toMatchObject({ isPublic: false, sharedWithUserIds: [], requiredWorkers: null, clearRequiredWorkers: true })
  })
})
