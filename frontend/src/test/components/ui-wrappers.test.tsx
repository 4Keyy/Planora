import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Avatar } from "@/components/ui/avatar"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { MasonryColumns } from "@/components/ui/masonry-columns"
import { ModalPortal } from "@/components/ui/modal-portal"
import { Textarea } from "@/components/ui/textarea"
import { Toaster } from "@/components/ui/toast"
import * as config from "@/lib/config"
import { useToastStore } from "@/store/toast"

describe("input and textarea wrappers", () => {
  it("renders a bare input without a counter, so a flex row can stretch it", () => {
    // A wrapping div became the flex item and shrank the profile page's fields to their
    // intrinsic width; the <input> itself must be the item.
    const { container } = render(<Input aria-label="plain" />)
    const input = screen.getByLabelText("plain")
    expect(container.firstElementChild).toBe(input)
    expect(input).toHaveClass("field-box")
  })

  it("keeps a caller's onBlur and draws no overlay of its own", async () => {
    // react-hook-form's register() passes onBlur; it used to replace the component's own
    // handler, and the focus glow then stayed on after the field was left.
    const user = userEvent.setup()
    const onBlur = vi.fn()
    const { container } = render(<Input aria-label="email" onBlur={onBlur} />)
    await user.click(screen.getByLabelText("email"))
    await user.tab()
    expect(onBlur).toHaveBeenCalledTimes(1)
    expect(container.querySelector("[aria-hidden]")).toBeNull()
  })

  it("marks an over-limit field so its focus edge stays red", () => {
    render(<Input aria-label="limited" maxLength={10} showCount value="123456789" readOnly />)
    expect(screen.getByLabelText("limited")).toHaveAttribute("data-over-limit", "true")
    render(<Textarea aria-label="notes" maxLength={10} showCount value="123456789" readOnly />)
    expect(screen.getByLabelText("notes")).toHaveAttribute("data-over-limit", "true")
    expect(screen.getByLabelText("notes")).toHaveClass("field-box")
  })

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

    expect(screen.getByText("8/10")).toHaveClass("text-alert")

    rerender(<Textarea aria-label="description" maxLength={10} showCount value="1234567895" readOnly />)

    expect(screen.getByText("10/10")).toHaveClass("text-alert")
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

  it("renders a 'don't ask again' checkbox and reports its state on confirm", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <ConfirmDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={onConfirm}
        title="Finish task"
        description="Still has open subtasks"
        confirmText="Finish"
        dontAskAgainLabel="Don't show again"
      />,
    )

    expect(await screen.findByText("Don't show again")).toBeInTheDocument()
    const checkbox = screen.getByRole("checkbox")
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)
    await user.click(screen.getByRole("button", { name: "Finish" }))

    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it("omits the checkbox when no dontAskAgainLabel is given", async () => {
    render(
      <ConfirmDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Plain"
        description="No checkbox here"
      />,
    )

    await screen.findByText("Plain")
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
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

  it("keeps every card in its column when an earlier one leaves or a new one arrives", () => {
    // Re-dealing from scratch moved every later card into another column, where it
    // remounted and replayed its entrance — half the grid blinked on every change.
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true })
    const ids = ["a", "b", "c", "d", "e", "f"]
    const props = {
      getKey: (item: { id: string }) => item.id,
      renderItem: (item: { id: string }) => <span data-card={item.id}>{item.id}</span>,
      columns: 3,
    }
    const { container, rerender } = render(<MasonryColumns items={ids.map((id) => ({ id }))} {...props} />)
    const columnOf = (id: string) => {
      const node = container.querySelector(`[data-card="${id}"]`)!
      return [...container.querySelectorAll('[class*="flex-col"]')].findIndex((col) => col.contains(node))
    }
    const before = Object.fromEntries(["d", "e", "f"].map((id) => [id, columnOf(id)]))
    const nodeF = container.querySelector('[data-card="f"]')

    rerender(<MasonryColumns items={["b", "c", "d", "e", "f", "g"].map((id) => ({ id }))} {...props} />)

    // The same element, in the same column: nothing remounted.
    expect(container.querySelector('[data-card="f"]')).toBe(nodeF)
    for (const id of ["d", "e", "f"]) expect(columnOf(id)).toBe(before[id])
    // The newcomer lands in a column with room: the one "a" left.
    expect(columnOf("g")).toBe(0)
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
    expect(container.firstChild).toHaveClass("z-toast", "pointer-events-none")

    fireEvent.click(screen.getByRole("button"))

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})

describe("Avatar", () => {
  beforeEach(() => {
    vi.spyOn(config, "getApiBaseUrl").mockReturnValue("http://localhost:5000")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders initials fallback when no src is supplied", () => {
    render(<Avatar firstName="Ada" lastName="Lovelace" />)
    expect(screen.getByText("AL")).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it("falls back to the first two letters of email when no name is present", () => {
    render(<Avatar email="zoe@example.com" />)
    expect(screen.getByText("ZO")).toBeInTheDocument()
  })

  it("falls back to a literal 'U' when nothing identifies the user", () => {
    render(<Avatar />)
    expect(screen.getByText("U")).toBeInTheDocument()
  })

  it("renders the optimised image once a relative src is resolved against the API origin", async () => {
    render(
      <Avatar
        src="/avatars/ada.png"
        firstName="Ada"
        lastName="Lovelace"
      />,
    )

    const img = await screen.findByAltText("Ada")
    const src = img.getAttribute("src") ?? ""
    expect(decodeURIComponent(src)).toContain("http://localhost:5000/avatars/ada.png")
    expect(screen.queryByText("AL")).not.toBeInTheDocument()
  })

  it("default-renders a lazy-loaded image (no priority prop)", async () => {
    render(
      <Avatar
        src="/avatars/ada.png"
        firstName="Ada"
        lastName="Lovelace"
      />,
    )

    const img = await screen.findByAltText("Ada")
    // next/image lazy by default — the loading attribute is `lazy` when
    // `priority` is not set. fetchpriority should also stay at its default.
    expect(img.getAttribute("loading")).toBe("lazy")
  })

  it("opts the image out of lazy-loading when priority is set", async () => {
    render(
      <Avatar
        src="/avatars/ada.png"
        firstName="Ada"
        lastName="Lovelace"
        priority
      />,
    )

    const img = await screen.findByAltText("Ada")
    // next/image translates `priority` into `loading="eager"` and
    // `fetchpriority="high"`. We assert the visible attribute we need — an
    // LCP-critical avatar must not be lazy-deferred.
    expect(img.getAttribute("loading")).not.toBe("lazy")
  })

  it("preserves the absolute http(s) src verbatim (no API-origin rewrite)", async () => {
    render(
      <Avatar
        src="https://cdn.example.com/u/ada.png"
        firstName="Ada"
        lastName="Lovelace"
      />,
    )

    const img = await screen.findByAltText("Ada")
    const src = img.getAttribute("src") ?? ""
    // The optimiser-routed url should contain the original absolute URL after decoding.
    expect(decodeURIComponent(src)).toContain("https://cdn.example.com/u/ada.png")
  })
})
