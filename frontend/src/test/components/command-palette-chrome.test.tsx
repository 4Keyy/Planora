import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EmptyState, Footer, Key, RollingHint, ScopeBar, ScopeChip, SkeletonRows, TabBar, ViewChips } from "@/components/command-palette/chrome"
import { Preview } from "@/components/command-palette/preview"
import { RowContent, audience } from "@/components/command-palette/rows"
import { SMART_VIEWS, type PaletteTask } from "@/components/command-palette/search"
import { SCREENS, ACTIONS, type PaletteItem } from "@/components/command-palette/sections"

let reduce = false
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => reduce,
}))

beforeEach(() => {
  reduce = false
})

afterEach(() => {
  vi.useRealTimers()
})

const NOW = new Date(2026, 9, 7, 9, 30)
const day = (days: number) => new Date(2026, 9, 7 + days, 12).toISOString()
const NAMES = new Map([["ada", "Ada Lovelace"], ["ben", "Ben Okri"]])

function task(over: Partial<PaletteTask> = {}): PaletteTask {
  return {
    id: "t",
    title: "Book the flights",
    description: null,
    completed: false,
    completedAt: null,
    inProgress: false,
    dueDate: null,
    dueDateStart: null,
    priority: 3,
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    categoryIcon: null,
    mine: true,
    ownerId: "me",
    ownerName: null,
    sharedWithAll: false,
    sharedWith: [],
    workers: [],
    openSubtasks: 0,
    urgent: false,
    keywords: "",
    ...over,
  }
}

const taskItem = (t: PaletteTask): PaletteItem => ({ key: `task:${t.id}`, kind: "task", label: t.title, task: t, action: { type: "open-task", taskId: t.id } })
const screenItem = (i = 0): PaletteItem => ({ key: `screen:${SCREENS[i].id}`, kind: "screen", label: SCREENS[i].label, hint: SCREENS[i].hint, icon: SCREENS[i].icon, action: SCREENS[i].action })

// ─── The rolling hint ───────────────────────────────────────────────────────

describe("RollingHint", () => {
  // "tasks" is there twice: first, and as the copy that closes the loop.
  const column = () => screen.getAllByText("tasks")[0].parentElement as HTMLElement

  it("rolls the last word through the kinds, and loops without running backwards", () => {
    vi.useFakeTimers()
    render(<RollingHint />)
    expect(column().style.transform).toBe("translateY(0%)")
    act(() => vi.advanceTimersByTime(2600))
    expect(column().style.transform).toBe("translateY(-20%)")
    act(() => vi.advanceTimersByTime(2600 * 3))
    expect(column().style.transform).toBe("translateY(-80%)")
    // The copy of the first word is on screen; the jump back happens without a transition.
    fireEvent.transitionEnd(column())
    expect(column().style.transform).toBe("translateY(0%)")
    expect(column()).not.toHaveClass("transition-transform")
    act(() => vi.advanceTimersByTime(2600))
    expect(column()).toHaveClass("transition-transform")
    expect(column().style.transform).toBe("translateY(-20%)")
  })

  it("never rolls past the copy when the transition end never arrives", () => {
    vi.useFakeTimers()
    render(<RollingHint />)
    act(() => vi.advanceTimersByTime(2600 * 5))
    expect(column().style.transform).toBe("translateY(0%)")
  })

  it("ignores the end of a transition in the middle of the loop", () => {
    vi.useFakeTimers()
    render(<RollingHint />)
    act(() => vi.advanceTimersByTime(2600))
    fireEvent.transitionEnd(column())
    expect(column().style.transform).toBe("translateY(-20%)")
  })

  it("says where it searches when narrowed, and holds still under reduced motion", () => {
    const { rerender } = render(<RollingHint scopeLabel="Travel" />)
    expect(screen.getByText("Search in Travel…")).toBeInTheDocument()
    reduce = true
    rerender(<RollingHint />)
    expect(screen.getByText("Search tasks, categories, people and commands…")).toBeInTheDocument()
  })
})

// ─── Keys and footer ────────────────────────────────────────────────────────

describe("Footer", () => {
  it("names what Enter does, offers Tab only where it narrows, and presses the caps", () => {
    const { rerender, container } = render(
      <Footer pressed={["down"]} isApple={false} primary="open" newTab narrow={false} filters escape="close" />,
    )
    expect(container).toHaveTextContent("open")
    expect(container).toHaveTextContent("new tab")
    expect(container).toHaveTextContent("Ctrl")
    expect(container).not.toHaveTextContent("Tab")
    expect(screen.getByText("↓")).toHaveAttribute("data-pressed")
    expect(screen.getByText("↑")).not.toHaveAttribute("data-pressed")

    rerender(<Footer pressed={["mod", "enter"]} isApple primary="narrow" newTab={false} narrow filters={false} escape="back" />)
    expect(container).toHaveTextContent("Tab")
    expect(container).not.toHaveTextContent("filter")
    expect(container).not.toHaveTextContent("new tab")
    expect(container).toHaveTextContent("back")

    rerender(<Footer pressed={[]} isApple primary={null} newTab={false} narrow={false} filters escape="clear" />)
    expect(container).toHaveTextContent("filter")
    expect(container).toHaveTextContent("clear")
  })

  it("draws a key cap that goes down when pressed", () => {
    render(<Key pressed>K</Key>)
    expect(screen.getByText("K")).toHaveAttribute("data-pressed", "")
  })
})

// ─── Scope, tabs, chips, states ─────────────────────────────────────────────

describe("scope controls", () => {
  it("shows a chip for each kind of scope, removable by pointer", () => {
    const onRemove = vi.fn()
    const { rerender } = render(<ScopeChip scope={{ kind: "category", id: "c", label: "Travel", color: "#0ea5e9", icon: "Plane" }} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole("button", { name: "Stop narrowing to Travel" }))
    expect(onRemove).toHaveBeenCalled()
    rerender(<ScopeChip scope={{ kind: "category", id: "c", label: "Loose", color: null, icon: "NoSuchIcon" }} onRemove={onRemove} />)
    expect(screen.getByText("Loose")).toBeInTheDocument()
    rerender(<ScopeChip scope={{ kind: "person", id: "ada", label: "Ada", avatar: null }} onRemove={onRemove} />)
    expect(screen.getByText("Ada")).toBeInTheDocument()
    rerender(<ScopeChip scope={{ kind: "view", id: "overdue", label: "Overdue" }} onRemove={onRemove} />)
    expect(screen.getByText("Overdue")).toBeInTheDocument()
  })

  it("summarises a scope and offers the way back", () => {
    const onBack = vi.fn()
    const { container, rerender } = render(<ScopeBar scope={{ kind: "view", id: "today", label: "Due today" }} open={1} done={0} onBack={onBack} />)
    expect(container).toHaveTextContent("Due today · 1 task")
    fireEvent.click(screen.getByRole("button", { name: "All results" }))
    expect(onBack).toHaveBeenCalled()
    rerender(<ScopeBar scope={{ kind: "category", id: "c", label: "Home", color: null, icon: null }} open={2} done={3} onBack={onBack} />)
    expect(container).toHaveTextContent("Home · 2 open · 3 done")
    rerender(<ScopeBar scope={{ kind: "person", id: "ada", label: "Ada", avatar: null }} open={0} done={0} onBack={onBack} />)
    expect(container).toHaveTextContent("Ada · 0 open")
  })

  it("dims an empty tab and names the counts", () => {
    const onSelect = vi.fn()
    render(<TabBar tab="all" counts={{ tasks: 1, categories: 0, people: 2, commands: 0 }} onSelect={onSelect} />)
    expect(screen.getByRole("button", { name: "Categories, 0 results" })).toHaveClass("text-ink-subtle")
    fireEvent.click(screen.getByRole("button", { name: "People, 2 results" }))
    expect(onSelect).toHaveBeenCalledWith("people")
  })

  it("shows only the views that have an answer, and none at all when none do", () => {
    const onPick = vi.fn()
    const views = SMART_VIEWS.map((v, i) => ({ ...v, count: i === 0 ? 3 : 0 }))
    const { container, rerender } = render(<ViewChips views={views} onPick={onPick} />)
    fireEvent.click(screen.getByRole("button", { name: "Overdue, 3 tasks" }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "overdue" }))
    expect(screen.getAllByRole("button")).toHaveLength(1)
    rerender(<ViewChips views={views.map((v) => ({ ...v, count: 0 }))} onPick={onPick} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders the empty and loading states", () => {
    const { container } = render(<><EmptyState title="Nothing here" hint="Try again" /><SkeletonRows /></>)
    expect(screen.getByText("Nothing here")).toBeInTheDocument()
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(4)
  })
})

// ─── Rows ───────────────────────────────────────────────────────────────────

describe("rows", () => {
  it("says who a task concerns in a few words", () => {
    expect(audience(task({ mine: false, ownerName: "Ada" }), NAMES)).toBe("from Ada")
    expect(audience(task({ mine: false }), NAMES)).toBe("shared with you")
    expect(audience(task({ sharedWithAll: true }), NAMES)).toBe("all friends")
    expect(audience(task(), NAMES)).toBeNull()
    expect(audience(task({ sharedWith: ["x"] }), NAMES)).toBe("with 1 friend")
    expect(audience(task({ sharedWith: ["x", "y"] }), NAMES)).toBe("with 2 friends")
    expect(audience(task({ sharedWith: ["ada"] }), NAMES)).toBe("with Ada Lovelace")
    expect(audience(task({ sharedWith: ["ada", "ben", "x"] }), NAMES)).toBe("with Ada Lovelace +2")
  })

  it("draws a task's line: category, people, progress, steps and deadline", () => {
    const { container } = render(
      <RowContent
        item={taskItem(task({ categoryName: "Travel", categoryColor: "#0ea5e9", categoryIcon: "Plane", sharedWith: ["ada"], inProgress: true, openSubtasks: 2, dueDate: day(-1) }))}
        active
        now={NOW}
        names={NAMES}
      />,
    )
    expect(container).toHaveTextContent("Travel")
    expect(container).toHaveTextContent("with Ada Lovelace")
    expect(container).toHaveTextContent("in progress")
    expect(container).toHaveTextContent("2 steps open")
    expect(container).toHaveTextContent("Yesterday")
  })

  it("draws a finished task, a category, a person, a view and a command", () => {
    const { container, rerender } = render(<RowContent item={taskItem(task({ completed: true, openSubtasks: 1 }))} active={false} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("done")
    expect(container).not.toHaveTextContent("step")

    const category: PaletteItem = { key: "category:c", kind: "category", label: "Travel", category: { id: "c", name: "Travel", description: null, color: null, icon: null, open: 1 }, action: { type: "scope", scope: { kind: "category", id: "c", label: "Travel", color: null, icon: null } } }
    rerender(<RowContent item={category} active now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("1 open task")
    expect(container).toHaveTextContent("Tab")

    const person = (shared: number): PaletteItem => ({ key: "person:ada", kind: "person", label: "Ada", person: { id: "ada", name: "Ada", email: "ada@example.test", avatar: null, shared }, action: { type: "scope", scope: { kind: "person", id: "ada", label: "Ada", avatar: null } } })
    rerender(<RowContent item={person(0)} active={false} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("ada@example.test")
    rerender(<RowContent item={person(1)} active={false} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("1 shared task")

    const view: PaletteItem = { key: "view:overdue", kind: "view", label: "Overdue", view: { ...SMART_VIEWS[0], count: 0 }, action: { type: "scope", scope: { kind: "view", id: "overdue", label: "Overdue" } } }
    rerender(<RowContent item={view} active={false} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("Past their deadline")

    const capture: PaletteItem = { key: "action:capture", kind: "action", label: ACTIONS[0].label, hint: ACTIONS[0].hint, icon: ACTIONS[0].icon, shortcut: "C", action: ACTIONS[0].action }
    rerender(<RowContent item={capture} active now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("C")
  })
})

// ─── Preview ────────────────────────────────────────────────────────────────

describe("Preview", () => {
  it("describes a task: deadline, priority, people, workers and steps", () => {
    const { container } = render(
      <Preview
        item={taskItem(task({ description: "Lisbon", dueDate: day(3), mine: false, ownerName: "Ada", workers: [{ id: "ben", name: "Ben" }, { id: "x", name: null }], openSubtasks: 2, categoryName: "Travel", categoryColor: "#0ea5e9" }))}
        scope={null}
        tasks={[]}
        now={NOW}
        names={NAMES}
      />,
    )
    expect(container).toHaveTextContent("Lisbon")
    expect(container).toHaveTextContent("in 3 days")
    expect(container).toHaveTextContent("From Ada")
    expect(container).toHaveTextContent("Ben")
    expect(container).toHaveTextContent("2 open")
  })

  it("words every distance to a deadline", () => {
    const cases: Array<[number, string]> = [[-1, "1 day late"], [-4, "4 days late"], [0, "today"], [1, "tomorrow"]]
    for (const [offset, text] of cases) {
      const { container, unmount } = render(<Preview item={taskItem(task({ dueDate: day(offset) }))} scope={null} tasks={[]} now={NOW} names={NAMES} />)
      expect(container).toHaveTextContent(text)
      unmount()
    }
    const { container } = render(<Preview item={taskItem(task())} scope={null} tasks={[]} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("No deadline")
    expect(container).toHaveTextContent("No details yet.")
    expect(container).toHaveTextContent("Only you")
  })

  it("shows when a finished task was done", () => {
    const { container, rerender } = render(<Preview item={taskItem(task({ completed: true, completedAt: day(-1) }))} scope={null} tasks={[]} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("October 6, 2026")
    rerender(<Preview item={taskItem(task({ completed: true }))} scope={null} tasks={[]} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("Yes")
  })

  it("previews a scope by the open tasks it holds", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => task({ id: `t${i}`, title: `Trip ${i}`, categoryId: "c", categoryColor: i ? null : "#0ea5e9" }))
    const category: PaletteItem = { key: "category:c", kind: "category", label: "Travel", category: { id: "c", name: "Travel", description: "Trips", color: "#0ea5e9", icon: "Plane", open: 7 }, action: { type: "scope", scope: { kind: "category", id: "c", label: "Travel", color: "#0ea5e9", icon: "Plane" } } }
    const { container, rerender } = render(<Preview item={category} scope={null} tasks={tasks} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("7 open tasks · Trips")
    expect(container).toHaveTextContent("and 2 more")

    const person: PaletteItem = { key: "person:ada", kind: "person", label: "Ada", person: { id: "ada", name: "Ada", email: null, avatar: null, shared: 0 }, action: { type: "scope", scope: { kind: "person", id: "ada", label: "Ada", avatar: null } } }
    rerender(<Preview item={person} scope={null} tasks={tasks} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("Nothing open here.")

    rerender(<Preview item={null} scope={{ kind: "view", id: "overdue", label: "Overdue" }} tasks={[]} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("0 open tasks")
    rerender(<Preview item={null} scope={{ kind: "category", id: "z", label: "Empty", color: null, icon: null }} tasks={[]} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("Empty")
  })

  it("previews a command, the offer to create, and nothing", () => {
    const { container, rerender } = render(<Preview item={screenItem()} scope={null} tasks={[]} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent(SCREENS[0].hint!)
    const capture: PaletteItem = { key: "action:capture", kind: "action", label: "Capture a task", icon: ACTIONS[0].icon, shortcut: "C", action: { type: "capture" } }
    rerender(<Preview item={capture} scope={null} tasks={[]} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("does this from any screen")
    rerender(<Preview item={{ key: "create", kind: "create", label: "Create task “x”", action: { type: "capture", title: "x" } }} scope={null} tasks={[]} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("Create task “x”")
    rerender(<Preview item={null} scope={null} tasks={[]} now={NOW} names={NAMES} />)
    expect(container).toHaveTextContent("Nothing highlighted")
  })
})
