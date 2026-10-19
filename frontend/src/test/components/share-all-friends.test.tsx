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
// The map orders friends by closeness. Unmocked, its request fails in jsdom, the client's
// refresh fails after it and signs the store out — the editor then stops being the owner's,
// its autosave switches off, and "autosaves that payload" waits for a save that never comes.
vi.mock("@/hooks/use-friend-affinity", () => ({ useFriendAffinity: () => new Map() }))
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
  it("creates an All friends task when the second current friend is picked on the map", async () => {
    const onSubmit = createPanel()
    // No chips under the map in the New task panel: the seats are the buttons.
    expect(screen.queryByRole("group", { name: "Share with" })).toBeNull()
    fireEvent.click(await screen.findByRole("button", { name: "Share with Ada Friend" }))
    expect(screen.getByRole("button", { name: "Shared with 1 friend" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Share with Grace Friend" }))
    expect(screen.getByRole("button", { name: "Shared with all friends" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "All friends" })).toHaveAttribute("aria-pressed", "true")
    expect(await submitTask(onSubmit)).toMatchObject({ isPublic: true, sharedWithUserIds: [], requiredWorkers: null })
  })

  it("lets one friend out of All friends as a direct share with the rest", async () => {
    const onSubmit = createPanel()
    fireEvent.click(await screen.findByRole("button", { name: "All friends" }))
    expect(screen.getByRole("button", { name: "Shared with all friends" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Share with Ada Friend" }))
    expect(screen.getByRole("button", { name: "Shared with 1 friend" })).toBeInTheDocument()
    expect(await submitTask(onSubmit)).toMatchObject({ isPublic: false, sharedWithUserIds: ["friend-2"], requiredWorkers: 2 })
  })

  it("goes back to private with Only you", async () => {
    const onSubmit = createPanel()
    fireEvent.click(await screen.findByRole("button", { name: "Share with Grace Friend" }))
    fireEvent.click(screen.getByRole("button", { name: "Only you" }))
    expect(screen.getByRole("button", { name: "Private task" })).toBeInTheDocument()
    expect(await submitTask(onSubmit)).toMatchObject({ isPublic: false, sharedWithUserIds: [] })
  })

  it("says what to do with no friends yet and keeps the task private", async () => {
    fixture.friends = []
    const onSubmit = createPanel()
    expect(await screen.findByText(/No friends to share with yet/)).toBeInTheDocument()
    expect(await submitTask(onSubmit)).toMatchObject({ isPublic: false, sharedWithUserIds: [] })
  })

  it("turns the editor's final picked friend into All friends and autosaves that payload", async () => {
    const { onSave } = editor(todo({ sharedWithUserIds: ["friend-1"] }))
    fireEvent.click(await screen.findByRole("button", { name: "Share with Grace Friend" }))
    expect(fixture.ownerPayload).toMatchObject(publicPayload)
    // The token and the map's chip both say so.
    expect(screen.getByRole("button", { name: "Share with all friends" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getAllByRole("button", { name: /all friends/i })).toHaveLength(2)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining(publicPayload)))
  })

  it("turns the All friends chip into All friends through the editor callback", async () => {
    editor(todo({ sharedWithUserIds: ["friend-1"] }))
    const chip = await screen.findByRole("button", { name: "Share with all friends" })
    expect(chip).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(chip)
    expect(fixture.ownerPayload).toMatchObject(publicPayload)
    expect(screen.getByRole("button", { name: "Share with all friends" })).toHaveAttribute("aria-pressed", "true")
  })

  it("compares coverage of current friends even when the direct selection has stale ids", async () => {
    editor(todo({ sharedWithUserIds: ["stale-friend", "friend-1"] }))
    fireEvent.click(await screen.findByRole("button", { name: "Share with Grace Friend" }))
    expect(fixture.ownerPayload).toMatchObject(publicPayload)
  })

  it("uses the same All friends rule in the branch page's sidebar", () => {
    editor(todo({ sharedWithUserIds: ["friend-1"] }), "page")
    fireEvent.click(screen.getByRole("button", { name: "Share with Grace Friend" }))
    expect(fixture.ownerPayload).toMatchObject(publicPayload)
    expect(screen.getByText("All your friends can see this.")).toBeInTheDocument()
    expect(screen.queryByText("Task access")).not.toBeInTheDocument()
  })

  it("seats everyone of an All friends task, and lets one friend out, leaving it shared with the rest", async () => {
    editor(todo({ isPublic: true, sharedWithUserIds: ["friend-1", "friend-2"] }))
    expect(await screen.findByRole("button", { name: "Share with Ada Friend" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Share with Grace Friend" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "Share with Ada Friend" }))
    expect(fixture.ownerPayload).toMatchObject(directPayload(["friend-2"]))
    expect(screen.getByText("You and Grace can see this.")).toBeInTheDocument()
  })

  it("seats only the frozen circle of an All friends task, not friends added since", async () => {
    editor(todo({ isPublic: true, sharedWithUserIds: ["friend-1"] }))
    expect(await screen.findByRole("button", { name: "Share with Ada Friend" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Share with Grace Friend" })).toHaveAttribute("aria-pressed", "false")
  })

  it("lets the only friend out of All friends, which leaves the task private", async () => {
    fixture.friends = [friends[0]]
    editor(todo({ isPublic: true, sharedWithUserIds: ["friend-1"] }))
    fireEvent.click(await screen.findByRole("button", { name: "Share with Ada Friend" }))
    expect(fixture.ownerPayload).toMatchObject({ isPublic: false, sharedWithUserIds: [], requiredWorkers: null, clearRequiredWorkers: true })
    expect(screen.getByText("Only you can see this.")).toBeInTheDocument()
  })

  it("takes All friends back to only you, from the chip or from Only you", async () => {
    editor(todo({ isPublic: true, sharedWithUserIds: ["friend-1", "friend-2"] }))
    fireEvent.click(await screen.findByRole("button", { name: "Only you" }))
    expect(fixture.ownerPayload).toMatchObject({ isPublic: false, sharedWithUserIds: [], requiredWorkers: null })
    expect(screen.getByRole("button", { name: /private/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Share with all friends" }))
    expect(fixture.ownerPayload).toMatchObject(publicPayload)
    fireEvent.click(screen.getByRole("button", { name: "Share with all friends" }))
    expect(fixture.ownerPayload).toMatchObject({ isPublic: false, sharedWithUserIds: [] })
  })

  it("keeps a task private, and says why, when there are no friends to share with", () => {
    fixture.friends = []
    editor(todo(), "page")
    expect(screen.getByText(/No friends to share with yet/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Share with all friends" })).toBeNull()
    expect(fixture.ownerPayload).toMatchObject({ isPublic: false, sharedWithUserIds: [] })
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
