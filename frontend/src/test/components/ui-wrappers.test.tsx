import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Avatar } from "@/components/ui/avatar"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { MasonryColumns, ROW_PX, dealColumns } from "@/components/ui/masonry-columns"
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
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("This cannot be undone")
    expect(screen.getByRole("dialog").style.animation).toBe("none")
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

  it("traps confirmation focus, restores its trigger, and resets the checkbox on reopening", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const warning = (isOpen: boolean) => <>
      <button>Open warning</button>
      <ConfirmDialog isOpen={isOpen} onClose={onClose} onConfirm={vi.fn()} title="Finish task"
        description="Still has open subtasks" dontAskAgainLabel="Don't show again" />
    </>
    const view = render(warning(false))
    const trigger = screen.getByRole("button", { name: "Open warning" })
    trigger.focus()
    view.rerender(warning(true))
    const close = screen.getByRole("button", { name: "Close" })
    await waitFor(() => expect(close).toHaveFocus())
    screen.getByRole("button", { name: "Confirm" }).focus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.click(screen.getByRole("checkbox"))
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
    view.rerender(warning(false))
    expect(trigger).toHaveFocus()
    expect(screen.getByRole("dialog").parentElement).toHaveClass("pointer-events-none")
    view.rerender(warning(true))
    expect(screen.getByRole("checkbox")).not.toBeChecked()
    await waitFor(() => expect(screen.getByRole("dialog").style.opacity).toBe("1"))
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

describe("dealColumns", () => {
  const tops = (heights: number[], columns: number, gap = 16) => dealColumns(heights, columns, gap).cards

  it("deals in list order, each card to the shortest column, the leftmost of equal ones", () => {
    expect(tops([100, 100, 100, 50, 80], 3).map((c) => c.column)).toEqual([0, 1, 2, 0, 1])
    // The second column's short card takes the fourth card, not the first column's tall one.
    expect(tops([300, 40, 40, 40], 2).map((c) => c.column)).toEqual([0, 1, 1, 1])
  })

  it("starts a card higher than the one before it only beside it, to its right, within a row", () => {
    const heights = [120, 46, 210, 90, 46, 160, 75, 300, 46, 46, 130, 88, 150, 62, 98, 104]
    for (const columns of [1, 2, 3, 4]) {
      const cards = tops(heights, columns)
      for (let i = 1; i < cards.length; i++) {
        if (cards[i].top >= cards[i - 1].top) continue
        expect(cards[i].column).toBeGreaterThan(cards[i - 1].column)
        expect(cards[i - 1].top - cards[i].top).toBeLessThanOrEqual(ROW_PX)
      }
    }
  })

  it("deals a row left to right: a column only a little shorter does not take the next card", () => {
    // After 100 and 96 the right column is 4px shorter — one row to the eye. The third card
    // goes left and the fourth right, so the second row reads in the list's order; with a
    // half-pixel tie the third went right and the fourth left, 4px lower, read first.
    expect(tops([100, 96, 50, 50], 2).map((c) => c.column)).toEqual([0, 1, 0, 1])
    // A column a row or more shorter still takes it: the columns stay even.
    expect(tops([100, 100 - ROW_PX - 1, 50], 2).map((c) => c.column)).toEqual([0, 1, 1])
  })

  it("never leaves a column empty while one to its right has cards", () => {
    for (let n = 1; n <= 7; n++) {
      const used = new Set(tops(Array.from({ length: n }, (_, i) => 50 + ((i * 37) % 90)), 3).map((c) => c.column))
      const highest = Math.max(...used)
      for (let c = 0; c <= highest; c++) expect(used.has(c)).toBe(true)
    }
  })

  it("places a card by the cards before it only, and reports the tallest column", () => {
    const before = tops([90, 60, 120, 40], 3)
    const after = tops([90, 60, 120, 40, 500, 30], 3)
    expect(after.slice(0, 4)).toEqual(before)
    const { height } = dealColumns([100, 50], 2, 16)
    expect(height).toBe(100)
    expect(dealColumns([], 3, 16)).toEqual({ cards: [], height: 0 })
    // A column count below one is one column.
    expect(dealColumns([10, 10], 0, 16).cards.map((c) => c.column)).toEqual([0, 0])
  })
})

describe("MasonryColumns", () => {
  // jsdom lays nothing out: a card's height is its `data-h`, the grid 900px wide.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return Number(this.querySelector<HTMLElement>("[data-h]")?.dataset.h ?? 0)
    })
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  type Card = { id: string; h: number }
  const props = {
    getKey: (item: Card) => item.id,
    renderItem: (item: Card) => <span data-card={item.id} data-h={item.h}>{item.id}</span>,
    columns: 3,
  }
  const cards = (spec: string) => spec.split(" ").map((entry) => {
    const [id, h] = entry.split(":")
    return { id, h: Number(h ?? 100) }
  })
  const box = (container: HTMLElement) => container.firstElementChild as HTMLElement
  const placed = (container: HTMLElement) =>
    [...box(container).children].map((el) => `${el.querySelector("[data-card]")?.getAttribute("data-card")}@${(el as HTMLElement).dataset.column}`)

  it("deals every card to the shortest column, in list order, as children of one box", () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true })
    const { container } = render(<MasonryColumns items={cards("a:300 b:40 c:40 d:40 e:40")} {...props} />)
    expect(placed(container)).toEqual(["a@0", "b@1", "c@2", "d@1", "e@2"])
    // Placed on the box by a transform, a third of it wide less the gaps.
    const d = box(container).children[3] as HTMLElement
    expect(d.style.position).toBe("absolute")
    expect(d.style.transform).toContain("translateY(56px)")
    expect(d.style.width).toContain("(100% - 32px)")
    expect(d.style.width).toContain("0.333")
    expect(box(container).style.height).toBe("300px")
  })

  it("re-deals from scratch when the list changes, keeping every card it already had mounted", () => {
    // Kept in their first columns, a filter left an empty column between two full ones.
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true })
    const { container, rerender } = render(<MasonryColumns items={cards("a b c d e f")} {...props} />)
    expect(placed(container)).toEqual(["a@0", "b@1", "c@2", "d@0", "e@1", "f@2"])
    const nodeD = container.querySelector('[data-card="d"]')

    rerender(<MasonryColumns items={cards("a c d f")} {...props} />)
    // The leaving cards fade where they are; the rest fill the columns in order.
    const staying = placed(container).filter((p) => /^[acdf]@/.test(p))
    expect(staying).toEqual(["a@0", "c@1", "d@2", "f@0"])
    // The same element: nothing remounted to change column.
    expect(container.querySelector('[data-card="d"]')).toBe(nodeD)
  })

  it("lays the cards out as a plain grid before they are measured, as the server paints them", async () => {
    const { renderToString } = await import("react-dom/server")
    const html = renderToString(<MasonryColumns items={cards("a b")} {...props} />)
    expect(html).toContain("grid-template-columns:repeat(3, minmax(0, 1fr))")
    expect(html).not.toContain("position:absolute")
  })

  it("responds to resize breakpoints", async () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })
    const { container } = render(
      <MasonryColumns items={cards("a b c")} {...props} columns={4} breakpoints={[{ maxWidth: 600, columns: 1 }]} />,
    )
    await waitFor(() => expect(placed(container)).toEqual(["a@0", "b@0", "c@0"]))
    expect((box(container).children[0] as HTMLElement).style.width).toContain("100% - 0px")
  })

  it("falls back to the base column count when no breakpoint matches", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true })
    const { container } = render(
      <MasonryColumns
        items={cards("a b c d")}
        {...props}
        breakpoints={[
          { maxWidth: 900, columns: 2 },
          { maxWidth: 600, columns: 1 },
        ]}
      />,
    )
    await waitFor(() => expect(placed(container)).toEqual(["a@0", "b@1", "c@2", "d@0"]))
  })

  it("follows the window across a breakpoint with a fresh deal", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true })
    const { container } = render(
      <MasonryColumns items={cards("a b c d")} {...props} breakpoints={[{ maxWidth: 1023, columns: 2 }]} />,
    )
    expect(placed(container)).toEqual(["a@0", "b@1", "c@2", "d@0"])
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true })
    act(() => {
      window.dispatchEvent(new Event("resize"))
    })
    await waitFor(() => expect(placed(container)).toEqual(["a@0", "b@1", "c@0", "d@1"]))
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
