import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Todo } from "@/types/todo"

const todo: Todo = {
  id: "task-1",
  userId: "owner",
  title: "Adaptive layout",
  status: "Todo",
  priority: "4",
  isPublic: false,
  isCompleted: false,
  tags: [],
  createdAt: "2026-10-01T00:00:00Z",
}

const props = (onClose = vi.fn()) => ({
  todo,
  categories: [],
  onClose,
  onSave: vi.fn(),
  onSaveViewerPreference: vi.fn(),
  onCreateCategory: vi.fn(),
})

/** A fresh copy of the lazy module, with the editor it loads standing in for the real one. */
async function lazyModule(editor: () => Promise<unknown>) {
  vi.resetModules()
  vi.doMock("@/components/todos/edit-todo-modal/index", editor)
  return import("@/components/todos/edit-todo-modal/lazy")
}

const editorModule = () =>
  Promise.resolve({
    EditTodoModal: ({ todo }: { todo: Todo }) => <div data-testid="editor">{todo.title}</div>,
    TodoEditor: () => null,
  })

describe("LazyEditTodoModal", () => {
  beforeEach(() => {
    vi.doUnmock("@/components/todos/edit-todo-modal/index")
  })

  it("shows nothing until the editor has loaded, then the editor", async () => {
    const { LazyEditTodoModal } = await lazyModule(editorModule)
    render(<LazyEditTodoModal {...props()} />)
    expect(screen.queryByTestId("editor")).toBeNull()
    expect(await screen.findByTestId("editor")).toHaveTextContent("Adaptive layout")
  })

  it("renders a warmed editor on its very first render, with nothing to wait for", async () => {
    const { LazyEditTodoModal, loadEditor } = await lazyModule(editorModule)
    await loadEditor()
    render(<LazyEditTodoModal {...props()} />)
    expect(screen.getByTestId("editor")).toHaveTextContent("Adaptive layout")
  })

  it("gives its place up when the editor cannot be fetched, so the next press asks again", async () => {
    const { LazyEditTodoModal } = await lazyModule(() => Promise.reject(new Error("offline")))
    const onClose = vi.fn()
    render(<LazyEditTodoModal {...props(onClose)} />)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId("editor")).toBeNull()
  })

  it("does nothing once it has gone away before the editor's fetch settled", async () => {
    let reject: ((error: unknown) => void) | undefined
    const { LazyEditTodoModal } = await lazyModule(() => new Promise((_, r) => (reject = r)))
    const onClose = vi.fn()
    const { unmount } = render(<LazyEditTodoModal {...props(onClose)} />)
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"))
    unmount()
    reject?.(new Error("offline"))
    await new Promise((r) => setTimeout(r, 0))
    expect(onClose).not.toHaveBeenCalled()
  })
})
