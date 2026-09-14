import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AlertTriangle, Users } from "lucide-react"
import { StatRow } from "@/components/ui/stat-row"
import { WeekBars } from "@/components/ui/week-bars"
import { UndoBar, useUndoableAction, UNDO_WINDOW_MS } from "@/components/ui/undo-bar"

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as typeof window.matchMedia
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── StatRow ────────────────────────────────────────────────────────────────

describe("StatRow", () => {
  it("renders a pressable filter for each stat", async () => {
    const onSelect = vi.fn()
    render(<StatRow stats={[{ id: "overdue", label: "overdue", value: 3, icon: AlertTriangle, onSelect }]} />)
    const button = screen.getByRole("button")
    await userEvent.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("renders a plain element when there is nothing to filter by", () => {
    render(<StatRow stats={[{ id: "shared", label: "shared", value: 4, icon: Users }]} />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("shared")).toBeInTheDocument()
  })

  it("marks the active filter with aria-pressed", () => {
    render(
      <StatRow
        stats={[{ id: "overdue", label: "overdue", value: 3, icon: AlertTriangle, onSelect: vi.fn(), active: true }]}
      />
    )
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true")
  })

  it("saves the alert tone for work that is genuinely late", () => {
    // An alert tone on a zero is a dashboard that shouts about nothing.
    const { container, rerender } = render(
      <StatRow stats={[{ id: "overdue", label: "overdue", value: 0, icon: AlertTriangle, tone: "alert" }]} />
    )
    expect(container.querySelector(".text-alert")).toBeNull()

    rerender(<StatRow stats={[{ id: "overdue", label: "overdue", value: 2, icon: AlertTriangle, tone: "alert" }]} />)
    expect(container.querySelector(".text-alert")).not.toBeNull()
  })
})

// ─── WeekBars ───────────────────────────────────────────────────────────────

describe("WeekBars", () => {
  const daysAgo = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    d.setHours(12, 0, 0, 0)
    return d.toISOString()
  }

  it("summarises the whole week in one sentence for assistive tech", () => {
    // Seven separately-labelled bars would make a screen-reader user tab through a
    // week of numbers to learn what a sighted user takes in at a glance.
    const { container } = render(<WeekBars completions={[daysAgo(0), daysAgo(0), daysAgo(3)]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("3 completed in the last seven days")
  })

  it("says so when the week is empty", () => {
    const { container } = render(<WeekBars completions={[]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("Nothing completed in the last seven days")
  })

  it("always draws seven bars, so the week reads as a week", () => {
    const { container } = render(<WeekBars completions={[daysAgo(1)]} />)
    expect(container.querySelectorAll(".origin-bottom")).toHaveLength(7)
  })

  it("ignores completions older than the window and unparseable dates", () => {
    const { container } = render(
      <WeekBars completions={[daysAgo(30), "not-a-date", null, undefined, daysAgo(2)]} />
    )
    expect(container.querySelector(".sr-only")).toHaveTextContent("1 completed in the last seven days")
  })

  it("hides the bars themselves from assistive tech", () => {
    const { container } = render(<WeekBars completions={[daysAgo(0)]} />)
    const chart = container.querySelector('[aria-hidden="true"]')
    expect(chart).toBeInTheDocument()
  })
})

// ─── UndoBar ────────────────────────────────────────────────────────────────

function UndoHarness({ onCommit, onRollback }: { onCommit: () => void; onRollback: () => void }) {
  const undoable = useUndoableAction()
  return (
    <>
      <button onClick={() => undoable.run({ label: "Task deleted", commit: onCommit, rollback: onRollback })}>
        delete
      </button>
      <UndoBar pending={undoable.pending} onUndo={undoable.undo} />
    </>
  )
}

describe("UndoBar", () => {
  it("shows nothing until something is pending", () => {
    render(<UndoBar pending={null} onUndo={vi.fn()} />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("defers the commit until the window closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const commit = vi.fn()
    const rollback = vi.fn()
    render(<UndoHarness onCommit={commit} onRollback={rollback} />)

    await userEvent.click(screen.getByText("delete"))
    expect(await screen.findByRole("status")).toHaveTextContent("Task deleted")
    // The whole point: nothing has happened yet.
    expect(commit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(UNDO_WINDOW_MS + 50)
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    expect(rollback).not.toHaveBeenCalled()
  })

  it("cancels the commit entirely when undone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const commit = vi.fn()
    const rollback = vi.fn()
    render(<UndoHarness onCommit={commit} onRollback={rollback} />)

    await userEvent.click(screen.getByText("delete"))
    await userEvent.click(await screen.findByRole("button", { name: /Undo/ }))
    expect(rollback).toHaveBeenCalledTimes(1)

    // Past the window, and the request still never happens — this is what makes
    // the undo honest rather than an optimistic lie. Asserting on the bar's
    // disappearance would test framer-motion's exit animation, which does not run
    // to completion in jsdom; the commit is the behaviour that matters.
    vi.advanceTimersByTime(UNDO_WINDOW_MS + 50)
    await waitFor(() => expect(commit).not.toHaveBeenCalled())
  })

  it("commits the first action when a second one starts", async () => {
    // Dropping it would lose a deletion silently; queueing would stack bars the
    // user cannot read.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const commit = vi.fn()
    render(<UndoHarness onCommit={commit} onRollback={vi.fn()} />)

    await userEvent.click(screen.getByText("delete"))
    await userEvent.click(screen.getByText("delete"))
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
  })

  it("commits anything still pending when it unmounts", async () => {
    // Navigating away is not taking it back.
    const commit = vi.fn()
    const view = render(<UndoHarness onCommit={commit} onRollback={vi.fn()} />)
    await userEvent.click(screen.getByText("delete"))
    view.unmount()
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
  })

  it("announces itself politely", async () => {
    render(<UndoHarness onCommit={vi.fn()} onRollback={vi.fn()} />)
    await userEvent.click(screen.getByText("delete"))
    expect(await screen.findByRole("status")).toHaveAttribute("aria-live", "polite")
  })
})
