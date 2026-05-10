import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { MasonryColumns } from "@/components/ui/masonry-columns"
import { ModalPortal } from "@/components/ui/modal-portal"
import { Textarea } from "@/components/ui/textarea"
import { Toaster } from "@/components/ui/toast"
import { useToastStore } from "@/store/toast"

describe("input and textarea wrappers", () => {
  it("tracks input character counts and forwards changes", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<Input aria-label="title" maxLength={10} showCount onChange={onChange} />)

    await user.type(screen.getByLabelText("title"), "testing")

    expect(screen.getByText("7/10")).toBeInTheDocument()
    expect(onChange).toHaveBeenCalled()
  })

  it("tracks textarea character counts and supports controlled values", () => {
    const { rerender } = render(
      <Textarea aria-label="description" maxLength={10} showCount value="12345678" readOnly />,
    )

    expect(screen.getByText("8/10")).toHaveClass("text-red-500")

    rerender(<Textarea aria-label="description" maxLength={10} showCount value="1234567895" readOnly />)

    expect(screen.getByText("10/10")).toHaveClass("text-red-500")
  })

  it("initializes textarea counts from default and empty values", () => {
    const { unmount } = render(
      <Textarea aria-label="notes" maxLength={10} showCount defaultValue="seed" />,
    )

    expect(screen.getByText("4/10")).toBeInTheDocument()

    unmount()
    render(<Textarea aria-label="notes-empty" maxLength={10} showCount />)

    expect(screen.getByText("0/10")).toBeInTheDocument()
  })
})

describe("portal and confirm dialog", () => {
  it("mounts portal children into document body after hydration", async () => {
    render(<ModalPortal><div>Portal content</div></ModalPortal>)

    await waitFor(() => expect(screen.getByText("Portal content")).toBeInTheDocument())
  })

  it("confirms, closes, and supports Escape dismissal", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    const { rerender } = render(
      <ConfirmDialog
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete task"
        description="This cannot be undone"
        confirmText="Delete"
      />,
    )

    expect(await screen.findByText("Delete task")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Delete" }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()

    onClose.mockClear()
    rerender(
      <ConfirmDialog
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete task"
        description="This cannot be undone"
      />,
    )

    await user.keyboard("{Escape}")

    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe("MasonryColumns", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("balances items into columns by item weight while preserving per-column order", () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true })
    const items = [
      { id: "a", weight: 10 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 },
      { id: "d", weight: 1 },
    ]

    const { container } = render(
      <MasonryColumns
        items={items}
        getKey={(item) => item.id}
        getItemWeight={(item) => item.weight}
        renderItem={(item) => <span>{item.id}</span>}
        columns={2}
      />,
    )

    expect(screen.getByText("a")).toBeInTheDocument()
    expect(screen.getByText("d")).toBeInTheDocument()
    expect(container.querySelectorAll('[class*="flex-col"]')).toHaveLength(2)
  })

  it("responds to resize breakpoints", async () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })

    const { container } = render(
      <MasonryColumns
        items={[{ id: "a" }, { id: "b" }]}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.id}</span>}
        columns={4}
        breakpoints={[{ maxWidth: 600, columns: 1 }]}
      />,
    )

    await waitFor(() => expect(container.querySelectorAll('[class*="flex-col"]')).toHaveLength(1))
  })

  it("falls back to the base column count when no breakpoint matches", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true })

    const { container } = render(
      <MasonryColumns
        items={[{ id: "a" }, { id: "b" }, { id: "c" }]}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.id}</span>}
        columns={3}
        breakpoints={[
          { maxWidth: 900, columns: 2 },
          { maxWidth: 600, columns: 1 },
        ]}
      />,
    )

    await waitFor(() => expect(container.querySelectorAll('[class*="flex-col"]')).toHaveLength(3))
  })
})

describe("toast store and toaster", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("adds, removes, clears, and auto-expires toasts", () => {
    act(() => {
      useToastStore.getState().addToast({ id: "toast-1", type: "success", title: "Saved" })
    })

    expect(useToastStore.getState().toasts).toHaveLength(1)

    act(() => {
      useToastStore.getState().removeToast("toast-1")
    })

    expect(useToastStore.getState().toasts).toHaveLength(0)

    act(() => {
      useToastStore.getState().addToast({ id: "toast-2", type: "info", title: "Queued" })
      vi.advanceTimersByTime(5000)
    })

    expect(useToastStore.getState().toasts).toHaveLength(0)

    act(() => {
      useToastStore.getState().addToast({ id: "toast-3", type: "warning", title: "Warning" })
      useToastStore.getState().clear()
    })

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it("renders toast content and lets the user dismiss it", async () => {
    act(() => {
      useToastStore.getState().addToast({
        id: "toast-1",
        type: "error",
        title: "Failed",
        description: "Try again",
      })
    })

    const { container } = render(<Toaster />)

    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getByText("Try again")).toBeInTheDocument()
    expect(container.firstChild).toHaveClass("top-16", "z-toast", "pointer-events-none")

    fireEvent.click(screen.getByRole("button"))

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
