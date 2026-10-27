import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BranchFeed } from "@/components/todos/edit-todo-modal/branch-feed"
import { useAuthStore } from "@/store/auth"
import { TodoPriority, TodoStatus, type Todo, type TodoComment } from "@/types/todo"

// The branch is the task's conversation: messages, replies, subtasks and the author's note, each
// written through the API helpers mocked here. The realtime room and typing presence are
// stubbed; `typing.names` stands in for other people typing.
const api = vi.hoisted(() => ({
  fetchComments: vi.fn(),
  addComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  fetchSubtasks: vi.fn(),
  createSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
  joinTodo: vi.fn(),
  leaveTodo: vi.fn(),
}))
vi.mock("@/lib/api", () => ({
  ...api,
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getApiErrorMessage: (error: unknown, fallback = "Something went wrong") =>
    error instanceof Error ? error.message : fallback,
}))

const typing = vi.hoisted(() => ({ names: [] as string[], notify: vi.fn() }))
vi.mock("@/lib/realtime/hooks", () => ({
  useBranchRoom: vi.fn(),
  useTyping: () => ({ typingNames: typing.names, notifyTyping: typing.notify }),
}))

const TODO_ID = "todo-1"
const ME = "user-me"

const message = (overrides: Partial<TodoComment> = {}): TodoComment => ({
  id: "c-1",
  todoItemId: TODO_ID,
  authorId: "user-ada",
  authorName: "Ada Lovelace",
  authorAvatarUrl: null,
  content: "The draft is ready",
  createdAt: "2026-10-26T09:00:00Z",
  updatedAt: null,
  isOwn: false,
  isEdited: false,
  ...overrides,
})

const subtask = (overrides: Partial<Todo> = {}): Todo => ({
  id: "s-1",
  userId: ME,
  createdByUserId: ME,
  parentTodoId: TODO_ID,
  title: "Book the venue",
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
  createdAt: "2026-10-26T08:00:00Z",
  updatedAt: null,
  sharedWithUserIds: [],
  isWorking: false,
  workerCount: 0,
  workers: [],
  ...overrides,
})

function serve(comments: TodoComment[], subtasks: Todo[] = []) {
  api.fetchComments.mockResolvedValue({ items: comments, totalCount: comments.length })
  api.fetchSubtasks.mockResolvedValue(subtasks)
}

/**
 * A message's reply/edit/delete buttons exist only while it is hovered. A plain `user.click`
 * moves the pointer first, and React reads that move as leaving the row — the buttons unmount
 * before the click lands. These flows hover the row themselves and click without moving.
 */
const hoverUser = () => userEvent.setup({ skipHover: true })

/**
 * A subtask's delete button stays mounted but parked outside a 50px strip at the card's right
 * edge, which clips it. The pointer slides it in by hovering that strip, keyboard focus by
 * reaching the button. The strip has no role or name of its own: found here by its position.
 */
function deleteStripOf(title: string): HTMLElement {
  let node: HTMLElement | null = screen.getByText(title)
  while (node) {
    const strip = [...node.children].find((child): child is HTMLElement =>
      child instanceof HTMLElement && child.style.position === "absolute" && child.style.right === "0px" && child.style.width === "50px")
    if (strip) return strip
    node = node.parentElement
  }
  throw new Error(`no delete strip around "${title}"`)
}

/** Where the delete button sits: parked to the right of its clipping strip, or slid in. */
const PARKED = { transform: "translateX(100%)" }
const SLID_IN = { transform: "none" }

async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  for (let presses = 0; presses < 40 && document.activeElement !== target; presses++) await user.tab()
  expect(target).toHaveFocus()
}

function renderFeed(props: Partial<ComponentProps<typeof BranchFeed>> = {}) {
  return render(<BranchFeed todoId={TODO_ID} isOwner {...props} />)
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  typing.names = []
  serve([])
  useAuthStore.setState({
    user: { userId: ME, email: "me@example.com", firstName: "Grace", lastName: "Hopper" },
    isAuthenticated: true,
  })
})

describe("BranchFeed", () => {
  it("shows the conversation and who is typing", async () => {
    typing.names = ["Ada Lovelace"]
    serve([
      message(),
      message({ id: "c-2", authorId: ME, authorName: "Grace Hopper", content: "Thanks, reading it now", isOwn: true, isEdited: true }),
    ])

    renderFeed()

    expect(await screen.findByText("The draft is ready")).toBeInTheDocument()
    expect(screen.getByText("Thanks, reading it now")).toBeInTheDocument()
    expect(screen.getByText("YOU")).toBeInTheDocument()
    expect(screen.getByText(/Ada Lovelace is typing/)).toBeInTheDocument()
    expect(api.fetchComments).toHaveBeenCalledWith(TODO_ID, 1, 50, { silent: true })
    expect(api.fetchSubtasks).toHaveBeenCalledWith(TODO_ID, { silent: true })
  })

  it("sends a message on Enter, keeps Shift+Enter for a new line, and tells others it is typing", async () => {
    const user = userEvent.setup()
    api.addComment.mockResolvedValue(message({ id: "c-new", authorId: ME, authorName: "Grace Hopper", content: "On it\ntoday", isOwn: true }))
    renderFeed()
    const box = await screen.findByPlaceholderText(/Write in branch/)

    await user.type(box, "On it{Shift>}{Enter}{/Shift}today")
    expect(typing.notify).toHaveBeenCalled()
    expect(api.addComment).not.toHaveBeenCalled()
    await user.keyboard("{Enter}")

    await waitFor(() => expect(api.addComment).toHaveBeenCalledWith(TODO_ID, "On it\ntoday", undefined))
    expect(await screen.findByText(/On it/)).toBeInTheDocument()
    expect(box).toHaveValue("")
  })

  it("does not send an empty message", async () => {
    renderFeed()
    const send = await screen.findByRole("button", { name: "Send message" })

    expect(send).toBeDisabled()
    await userEvent.setup().type(screen.getByPlaceholderText(/Write in branch/), "   {Enter}")
    expect(api.addComment).not.toHaveBeenCalled()
  })

  it("replies to a message with a quote of it, and Escape drops the reply first", async () => {
    const user = hoverUser()
    serve([message()])
    api.addComment.mockResolvedValue(message({ id: "c-reply", authorId: ME, authorName: "Grace Hopper", content: "Looks good", isOwn: true, replyToType: "comment", replyToId: "c-1", replyToAuthorName: "Ada Lovelace", replyToPreview: "The draft is ready" }))
    renderFeed()

    await user.hover(await screen.findByText("The draft is ready"))
    await user.click(screen.getByRole("button", { name: "Reply" }))
    expect(screen.getByRole("button", { name: "Cancel reply" })).toBeInTheDocument()

    const box = screen.getByPlaceholderText(/Write in branch/)
    await user.type(box, "{Escape}")
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel reply" })).not.toBeInTheDocument())

    await user.hover(screen.getByText("The draft is ready"))
    await user.click(screen.getByRole("button", { name: "Reply" }))
    await user.type(box, "Looks good{Enter}")
    await waitFor(() => expect(api.addComment).toHaveBeenCalledWith(TODO_ID, "Looks good", { type: "comment", id: "c-1" }))
  })

  it("edits its own message and marks the row edited", async () => {
    const user = hoverUser()
    serve([message({ id: "c-own", authorId: ME, authorName: "Grace Hopper", content: "Meet at ten", isOwn: true })])
    api.updateComment.mockResolvedValue({ content: "Meet at eleven", updatedAt: "2026-10-26T09:05:00Z" })
    renderFeed({ isOwner: false })

    await user.hover(await screen.findByText("Meet at ten"))
    await user.click(screen.getByRole("button", { name: "Edit message" }))
    const editor = screen.getByDisplayValue("Meet at ten")
    await user.clear(editor)
    await user.type(editor, "Meet at eleven{Enter}")

    await waitFor(() => expect(api.updateComment).toHaveBeenCalledWith(TODO_ID, "c-own", "Meet at eleven"))
    expect(await screen.findByText("Meet at eleven")).toBeInTheDocument()
    expect(screen.queryByDisplayValue("Meet at eleven")).not.toBeInTheDocument()
  })

  it("leaves the message as it was when an edit is cancelled with Escape", async () => {
    const user = hoverUser()
    serve([message({ id: "c-own", authorId: ME, content: "Meet at ten", isOwn: true })])
    renderFeed({ isOwner: false })

    await user.hover(await screen.findByText("Meet at ten"))
    await user.click(screen.getByRole("button", { name: "Edit message" }))
    await user.type(screen.getByDisplayValue("Meet at ten"), " sharp{Escape}")

    expect(api.updateComment).not.toHaveBeenCalled()
    expect(screen.getByText("Meet at ten")).toBeInTheDocument()
  })

  it("offers edit and delete only on messages the viewer may manage", async () => {
    const user = userEvent.setup()
    serve([message()])
    renderFeed({ isOwner: false })

    await user.hover(await screen.findByText("The draft is ready"))
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Edit message" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Delete message" })).not.toBeInTheDocument()
  })

  it("deletes a message, and keeps it with the reason when the server refuses", async () => {
    const user = hoverUser()
    serve([message({ id: "c-1", content: "First", isOwn: true }), message({ id: "c-2", content: "Second", isOwn: true })])
    api.deleteComment.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("You can no longer delete this message"))
    renderFeed()

    await user.hover(await screen.findByText("First"))
    await user.click(screen.getByRole("button", { name: "Delete message" }))
    await waitFor(() => expect(screen.queryByText("First")).not.toBeInTheDocument())
    expect(api.deleteComment).toHaveBeenCalledWith(TODO_ID, "c-1")

    await user.hover(screen.getByText("Second"))
    await user.click(screen.getByRole("button", { name: "Delete message" }))
    expect(await screen.findByText("You can no longer delete this message")).toBeInTheDocument()
    expect(screen.getByText("Second")).toBeInTheDocument()
  })

  it("adds a subtask from the + menu and goes back to writing messages", async () => {
    const user = userEvent.setup()
    api.createSubtask.mockResolvedValue(subtask({ id: "s-new", title: "Order the cake" }))
    renderFeed()

    await user.click(await screen.findByRole("button", { name: "Add a subtask or attachment" }))
    await user.click(screen.getByRole("button", { name: /Subtask/ }))
    const box = screen.getByPlaceholderText(/Add a subtask/)
    await user.type(box, "Order the cake{Enter}")

    await waitFor(() => expect(api.createSubtask).toHaveBeenCalledWith(TODO_ID, { title: "Order the cake" }))
    expect(await screen.findByText("Order the cake")).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Write in branch/)).toBeInTheDocument()
  })

  it("takes a subtask into work, then completes it, with the marker naming each step", async () => {
    const user = userEvent.setup()
    serve([], [subtask()])
    api.joinTodo.mockResolvedValue(subtask({ isWorking: true }))
    api.updateSubtask.mockResolvedValue(subtask({ status: "Done" as Todo["status"] }))
    renderFeed()

    // The round marker and the labelled footer button both take it into work.
    const [marker] = await screen.findAllByRole("button", { name: "Take subtask into work" })
    await user.click(marker)
    expect(api.joinTodo).toHaveBeenCalledWith("s-1")
    await user.click(await screen.findByRole("button", { name: "Complete subtask" }))
    await waitFor(() => expect(api.updateSubtask).toHaveBeenCalledWith("s-1", { status: "done" }))
    expect(await screen.findByRole("button", { name: "Reopen subtask" })).toBeInTheDocument()
  })

  it("puts a subtask back when completing it fails", async () => {
    const user = userEvent.setup()
    serve([], [subtask({ isWorking: true, workers: [{ userId: ME, name: "Grace Hopper", avatarUrl: null }], workerCount: 1 })])
    api.updateSubtask.mockRejectedValue(new Error("The subtask was deleted"))
    renderFeed()

    await user.click(await screen.findByRole("button", { name: "Complete subtask" }))

    expect(await screen.findByText("The subtask was deleted")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Complete subtask" })).toBeInTheDocument()
  })

  it("deletes a subtask, and brings it back with the reason when the server refuses", async () => {
    const user = hoverUser()
    serve([], [subtask(), subtask({ id: "s-2", title: "Send invites", createdAt: "2026-10-26T08:30:00Z" })])
    api.deleteSubtask.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Only the author can delete this subtask"))
    renderFeed()

    await screen.findByText("Book the venue")
    const venueStrip = deleteStripOf("Book the venue")
    await user.hover(venueStrip)
    await user.click(within(venueStrip).getByRole("button", { name: "Delete subtask" }))
    await waitFor(() => expect(screen.queryByText("Book the venue")).not.toBeInTheDocument())
    expect(api.deleteSubtask).toHaveBeenCalledWith("s-1")

    const invitesStrip = deleteStripOf("Send invites")
    await user.hover(invitesStrip)
    await user.click(within(invitesStrip).getByRole("button", { name: "Delete subtask" }))
    expect(await screen.findByText("Only the author can delete this subtask")).toBeInTheDocument()
    expect(screen.getByText("Send invites")).toBeInTheDocument()
  })

  it("deletes a subtask from the keyboard alone, the panel sliding in when Tab reaches it", async () => {
    const user = userEvent.setup()
    serve([], [subtask()])
    api.deleteSubtask.mockResolvedValue(undefined)
    renderFeed()
    await screen.findByText("Book the venue")

    // The delete button comes last in the card, after the controls the card already had.
    const [marker] = screen.getAllByRole("button", { name: "Take subtask into work" })
    await tabTo(user, marker)
    for (const name of ["Edit subtask", "Reply to subtask", "Take subtask into work", "Delete subtask"]) {
      await user.tab()
      expect(document.activeElement).toHaveAccessibleName(name)
    }
    const remove = screen.getByRole("button", { name: "Delete subtask" })
    await waitFor(() => expect(remove).toHaveStyle(SLID_IN))

    await user.tab({ shift: true })
    await waitFor(() => expect(remove).toHaveStyle(PARKED))
    await user.tab()
    await waitFor(() => expect(remove).toHaveStyle(SLID_IN))

    await user.keyboard("{Enter}")
    await waitFor(() => expect(screen.queryByText("Book the venue")).not.toBeInTheDocument())
    expect(api.deleteSubtask).toHaveBeenCalledWith("s-1")
  })

  it("slides the delete panel in for the pointer only over the strip, and pointer focus does not hold it", async () => {
    const user = userEvent.setup()
    serve([], [subtask()])
    renderFeed()
    const title = await screen.findByText("Book the venue")
    const remove = screen.getByRole("button", { name: "Delete subtask" })
    expect(remove).toHaveStyle(PARKED)

    // The card's own actions hide under an open panel, so showing them means it is closed.
    const cardActions = screen.getByRole("button", { name: "Edit subtask" }).parentElement!
    await user.hover(title)
    expect(cardActions).toHaveStyle({ opacity: "1" })
    expect(remove).toHaveStyle(PARKED)
    await user.hover(deleteStripOf("Book the venue"))
    expect(cardActions).toHaveStyle({ opacity: "0" })
    await waitFor(() => expect(remove).toHaveStyle(SLID_IN))

    // Pressing the button focuses it, as a click does on Windows; dragging off before letting go
    // must park the panel all the same, because that focus came from the pointer.
    await user.pointer({ keys: "[MouseLeft>]", target: remove })
    expect(remove).toHaveFocus()
    await user.pointer({ target: title })
    await user.pointer({ keys: "[/MouseLeft]", target: title })
    await waitFor(() => expect(remove).toHaveStyle(PARKED))
    expect(remove).toHaveFocus()
    expect(api.deleteSubtask).not.toHaveBeenCalled()
  })

  it("gives the delete button only to the task owner or the subtask's creator", async () => {
    serve([], [
      subtask({ title: "Mine" }),
      subtask({ id: "s-2", title: "Ada's", userId: "user-ada", createdByUserId: "user-ada", createdAt: "2026-10-26T08:30:00Z" }),
    ])
    renderFeed({ isOwner: false })
    await screen.findByText("Ada's")

    expect(screen.getAllByRole("button", { name: "Delete subtask" })).toHaveLength(1)
    expect(within(deleteStripOf("Mine")).getByRole("button", { name: "Delete subtask" })).toBeInTheDocument()
  })

  it("writes the task description from the + menu and reloads the note", async () => {
    const user = userEvent.setup()
    const onSaveDescription = vi.fn().mockResolvedValue(undefined)
    renderFeed({ onSaveDescription })

    await user.click(await screen.findByRole("button", { name: "Add a subtask or attachment" }))
    await user.click(screen.getByRole("button", { name: /Task description/ }))
    await user.type(screen.getByPlaceholderText(/Enter task description/), "Agenda and owners{Enter}")

    await waitFor(() => expect(onSaveDescription).toHaveBeenCalledWith("Agenda and owners"))
    await waitFor(() => expect(api.fetchComments.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it("edits the author's note in place for the owner", async () => {
    const user = userEvent.setup()
    const onSaveDescription = vi.fn().mockResolvedValue(undefined)
    serve([message({ id: "genesis", isGenesisComment: true, authorName: "Grace Hopper", content: "Agenda" })])
    renderFeed({ onSaveDescription })

    expect(await screen.findByText("Agenda")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Edit" }))
    const note = screen.getByDisplayValue("Agenda")
    await user.clear(note)
    await user.type(note, "Agenda and owners{Enter}")

    await waitFor(() => expect(onSaveDescription).toHaveBeenCalledWith("Agenda and owners"))
  })

  it("asks before completing a task that still has open subtasks", async () => {
    const user = userEvent.setup()
    const onCompleteTask = vi.fn().mockResolvedValue(undefined)
    serve([], [subtask(), subtask({ id: "s-2", title: "Send invites" })])
    renderFeed({ onCompleteTask })

    await screen.findByText("Send invites")
    await user.click(screen.getByRole("button", { name: "Add a subtask or attachment" }))
    await user.click(screen.getByRole("button", { name: /Complete task/ }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Some subtasks are still open")).toBeInTheDocument()
    expect(within(dialog).getByText(/2 unfinished subtasks/)).toBeInTheDocument()
    expect(onCompleteTask).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "Complete anyway" }))
    await waitFor(() => expect(onCompleteTask).toHaveBeenCalledTimes(1))
  })

  it("completes at once when every subtask is done", async () => {
    const user = userEvent.setup()
    const onCompleteTask = vi.fn().mockResolvedValue(undefined)
    serve([], [subtask({ status: "Done" as Todo["status"] })])
    renderFeed({ onCompleteTask })

    await screen.findByText("Book the venue")
    await user.click(screen.getByRole("button", { name: "Add a subtask or attachment" }))
    await user.click(screen.getByRole("button", { name: /Complete task/ }))

    await waitFor(() => expect(onCompleteTask).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("loads earlier messages above the ones on screen", async () => {
    const user = userEvent.setup()
    api.fetchComments
      .mockResolvedValueOnce({ items: [message({ id: "c-51", content: "Newest" })], totalCount: 51 })
      .mockResolvedValue({ items: [message({ id: "c-1", content: "Oldest", createdAt: "2026-10-25T09:00:00Z" })], totalCount: 51 })
    renderFeed()

    await user.click(await screen.findByRole("button", { name: /Load earlier messages/ }))

    expect(await screen.findByText("Oldest")).toBeInTheDocument()
    expect(screen.getByText("Newest")).toBeInTheDocument()
    expect(api.fetchComments).toHaveBeenCalledWith(TODO_ID, 2, 50, { silent: true })
  })
})
