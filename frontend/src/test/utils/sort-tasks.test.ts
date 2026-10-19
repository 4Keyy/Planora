import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getTaskWeight, keepPlace, sortTasks, type SortableTask } from "@/utils/sort-tasks"
import { TodoPriority, TodoStatus } from "@/types/todo"

const task = (id: string, overrides: Partial<SortableTask> = {}): SortableTask => ({
  id,
  createdAt: "2026-05-01T08:00:00.000Z",
  priority: TodoPriority.Medium,
  status: TodoStatus.Pending,
  isCompleted: false,
  ...overrides,
})

describe("sortTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("sorts active tasks by due-date bucket before completed tasks", () => {
    const sorted = sortTasks([
      task("no-date", { dueDate: null }),
      task("completed", {
        isCompleted: true,
        completedAt: "2026-05-01T10:00:00.000Z",
        dueDate: "2026-04-30T00:00:00.000Z",
      }),
      task("tomorrow", { dueDate: "2026-05-02T00:00:00.000Z" }),
      task("future", { dueDate: "2026-05-11T00:00:00.000Z" }),
      task("today", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("overdue", { dueDate: "2026-04-29T00:00:00.000Z" }),
      task("this-week", { dueDate: "2026-05-03T00:00:00.000Z" }),
    ])

    expect(sorted.map((item) => item.id)).toEqual([
      "overdue",
      "today",
      "tomorrow",
      "this-week",
      "future",
      "no-date",
      "completed",
    ])
  })

  it("uses priority as a tie-breaker for same-day tasks", () => {
    const sorted = sortTasks([
      task("none", { dueDate: "2026-05-01T00:00:00.000Z", priority: null }),
      task("very-low", { dueDate: "2026-05-01T00:00:00.000Z", priority: TodoPriority.VeryLow }),
      task("low", { dueDate: "2026-05-01T00:00:00.000Z", priority: TodoPriority.Low }),
      task("urgent", { dueDate: "2026-05-01T00:00:00.000Z", priority: TodoPriority.Urgent }),
      task("high", { dueDate: "2026-05-01T00:00:00.000Z", priority: "4" }),
    ])

    expect(sorted.map((item) => item.id)).toEqual(["urgent", "high", "low", "very-low", "none"])
  })

  it("preserves input order when every sort key is identical", () => {
    const sorted = sortTasks([
      task("a", { dueDate: null }),
      task("b", { dueDate: null }),
    ])

    expect(sorted.map((item) => item.id)).toEqual(["a", "b"])
  })

  it("places an in-progress task with a far-future due date at the front of the working group", () => {
    const sorted = sortTasks([
      task("regular", { dueDate: "2026-05-10T00:00:00.000Z" }),
      task("working-far", {
        status: TodoStatus.InProgress,
        dueDate: "2026-05-10T00:00:00.000Z",
      }),
    ])

    expect(sorted.map((t) => t.id)).toEqual(["working-far", "regular"])
  })

  it("places an in-progress task due today before non-in-progress tasks", () => {
    const sorted = sortTasks([
      task("regular-today", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("working-today", {
        status: TodoStatus.InProgress,
        dueDate: "2026-05-01T00:00:00.000Z",
      }),
    ])

    expect(sorted.map((t) => t.id)).toEqual(["working-today", "regular-today"])
  })

  it("sorts completed tasks with an invalid completedAt date without throwing", () => {
    const sorted = sortTasks([
      task("valid-completed", {
        isCompleted: true,
        completedAt: "2026-05-01T10:00:00.000Z",
      }),
      task("bad-date-completed", {
        isCompleted: true,
        completedAt: "not-a-date",
      }),
    ])

    expect(sorted.map((t) => t.id)).toHaveLength(2)
  })

  it("treats a task with status 'completed' (string) the same as isCompleted", () => {
    const sorted = sortTasks([
      task("active", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("string-completed", { status: "completed" }),
    ])

    expect(sorted.map((t) => t.id)).toEqual(["active", "string-completed"])
  })

  it("treats a task with status 'done' (string) as completed", () => {
    const sorted = sortTasks([
      task("active", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("string-done", { status: "done", isCompleted: false }),
    ])

    expect(sorted.map((t) => t.id)).toEqual(["active", "string-done"])
  })

  it("handles a task with null status in taskIsWorkingOn without throwing", () => {
    const sorted = sortTasks([
      task("null-status", { status: null }),
      task("active", { dueDate: "2026-05-01T00:00:00.000Z" }),
    ])

    expect(sorted.map((t) => t.id)).toHaveLength(2)
  })

  it("treats a task with isWorking true as in-progress and sorts it first", () => {
    const sorted = sortTasks([
      task("regular", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("is-working", { isWorking: true, dueDate: "2026-05-01T00:00:00.000Z" }),
    ])

    expect(sorted.map((t) => t.id)).toEqual(["is-working", "regular"])
  })

  it("handles a task with an invalid dueDate string without throwing", () => {
    const sorted = sortTasks([
      task("valid-due", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("bad-due", { dueDate: "not-a-date" }),
    ])

    expect(sorted.map((t) => t.id)).toHaveLength(2)
  })

  it("handles a task with an invalid createdAt string without throwing", () => {
    const sorted = sortTasks([
      task("normal", {}),
      task("bad-created", { createdAt: "not-a-date" }),
    ])

    expect(sorted.map((t) => t.id)).toHaveLength(2)
  })

  it("does not mutate the original array", () => {
    const original = [
      task("later", { dueDate: "2026-05-03T00:00:00.000Z" }),
      task("now", { dueDate: "2026-05-01T00:00:00.000Z" }),
    ]

    expect(sortTasks(original).map((item) => item.id)).toEqual(["now", "later"])
    expect(original.map((item) => item.id)).toEqual(["later", "now"])
  })
})

describe("task bands", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const ids = (tasks: SortableTask[]) => sortTasks(tasks).map((item) => item.id)
  const reference = [
    task("overdue", { dueDate: "2026-04-28T00:00:00.000Z" }),
    task("urgent-undated", { priority: TodoPriority.Urgent }),
    task("hidden-urgent", { hidden: true, priority: TodoPriority.Urgent, isVisuallyUrgent: true }),
    task("high", { priority: TodoPriority.High }),
    task("shared-high", { priority: TodoPriority.High, hasSharedAudience: true, createdAt: "2026-04-20T08:00:00.000Z" }),
    task("hidden-high", { hidden: true, priority: TodoPriority.High, isVisuallyUrgent: false }),
    task("shared", { hasSharedAudience: true, dueDate: "2026-05-20T00:00:00.000Z" }),
    task("hidden-shared", { hidden: true, priority: TodoPriority.Low, hasSharedAudience: true, isVisuallyUrgent: false }),
    task("working", { status: TodoStatus.InProgress, priority: TodoPriority.Low }),
    task("regular-tomorrow", { priority: TodoPriority.Low, dueDate: "2026-05-02T00:00:00.000Z" }),
    task("regular"),
    task("regular-old", { createdAt: "2026-04-01T08:00:00.000Z" }),
    task("hidden-regular", { hidden: true, isVisuallyUrgent: false }),
    task("done", { isCompleted: true }),
  ]
  const referenceIds = [
    "overdue", "urgent-undated", "hidden-urgent", "high", "shared-high", "hidden-high",
    "shared", "hidden-shared", "working", "regular-tomorrow", "regular", "regular-old",
    "hidden-regular", "done",
  ]

  it.each([
    ["reversed", [...reference].reverse()],
    ["interleaved", [...reference.filter((_, i) => i % 2), ...reference.filter((_, i) => i % 2 === 0)]],
  ] satisfies [string, SortableTask[]][])("matches the owner's complete reference for %s input", (_, input) => {
    expect(ids(input)).toEqual(referenceIds)
  })

  it("orders urgent, priority, shared and regular bands before completed tasks", () => {
    expect(ids([
      task("regular", { status: TodoStatus.InProgress }),
      task("done", { isCompleted: true, priority: TodoPriority.Urgent }),
      task("shared", { hasSharedAudience: true }),
      task("high", { priority: TodoPriority.High }),
      task("urgent", { priority: TodoPriority.Urgent }),
    ])).toEqual(["urgent", "high", "shared", "regular", "done"])
  })

  it.each([
    ["urgent", { priority: TodoPriority.Urgent }],
    ["priority", { priority: TodoPriority.High }],
    ["shared", { hasSharedAudience: true }],
    ["regular", {}],
  ] satisfies [string, Partial<SortableTask>][])("places hidden tasks after open ones within the %s band", (_, fields) => {
    expect(ids([
      task("hidden-working", { ...fields, hidden: true, isWorking: true }),
      task("open", fields),
    ])).toEqual(["open", "hidden-working"])
  })

  it("keeps hidden urgent tasks above open High tasks even without an open urgent task", () => {
    expect(ids([
      task("high", { priority: TodoPriority.High }),
      task("hidden-urgent", { hidden: true, isVisuallyUrgent: true }),
    ])).toEqual(["hidden-urgent", "high"])
  })

  it("puts High shared tasks in the priority band", () => {
    expect(ids([
      task("shared-working", { hasSharedAudience: true, isWorking: true }),
      task("shared-high", { priority: TodoPriority.High, hasSharedAudience: true }),
      task("high", { priority: TodoPriority.High, createdAt: "2026-05-01T09:00:00.000Z" }),
    ])).toEqual(["high", "shared-high", "shared-working"])
  })

  it.each([
    ["urgent", { priority: TodoPriority.Urgent }],
    ["priority", { priority: TodoPriority.High }],
    ["shared", { hasSharedAudience: true }],
    ["regular", {}],
  ] satisfies [string, Partial<SortableTask>][])("puts working tasks first inside the %s band", (_, fields) => {
    expect(ids([
      task("pending", { ...fields, dueDate: "2026-05-02T00:00:00.000Z" }),
      task("working", { ...fields, status: TodoStatus.InProgress }),
    ])).toEqual(["working", "pending"])
  })

  it("keeps working tasks below higher bands", () => {
    expect(ids([
      task("working", { status: TodoStatus.InProgress }),
      task("shared-working", { hasSharedAudience: true, isWorking: true }),
      task("high-working", { priority: TodoPriority.High, status: TodoStatus.InProgress }),
      task("urgent", { priority: TodoPriority.Urgent }),
    ])).toEqual(["urgent", "high-working", "shared-working", "working"])
  })

  it.each([
    ["pending dated", { dueDate: "2026-05-02T00:00:00.000Z" }],
    ["pending undated", {}],
    ["working dated", { dueDate: "2026-05-02T00:00:00.000Z", isWorking: true }],
    ["working undated", { isWorking: true }],
  ] satisfies [string, Partial<SortableTask>][])("puts newer %s tasks first when other keys match", (_, fields) => {
    expect(ids([
      task("older", { ...fields, createdAt: "2026-04-01T08:00:00.000Z" }),
      task("newer", fields),
    ])).toEqual(["newer", "older"])
  })

  it("uses the server's urgency flag before priority and due-date fallback", () => {
    expect(ids([
      task("false-overdue", { dueDate: "2026-04-28T00:00:00.000Z", isVisuallyUrgent: false }),
      task("false-urgent-priority", { priority: TodoPriority.Urgent, isVisuallyUrgent: false }),
      task("true-undated", { priority: TodoPriority.Low, isVisuallyUrgent: true }),
    ])).toEqual(["true-undated", "false-urgent-priority", "false-overdue"])
  })

  it.each([
    ["server audience", { hasSharedAudience: true }],
    ["public fallback", { isPublic: true }],
    ["shared users fallback", { sharedWithUserIds: ["viewer"] }],
    ["null audience fallback", { hasSharedAudience: null, isPublic: true }],
  ] satisfies [string, Partial<SortableTask>][])("recognizes shared tasks from %s", (_, fields) => {
    expect(ids([task("regular", { isWorking: true }), task("shared", fields)])).toEqual(["shared", "regular"])
  })

  it("uses an explicit false audience flag before public and shared-user fallbacks", () => {
    expect(ids([
      task("server-private", { hasSharedAudience: false, isPublic: true, sharedWithUserIds: ["viewer"], isWorking: true }),
      task("shared", { hasSharedAudience: true }),
    ])).toEqual(["shared", "server-private"])
  })

  it("keeps empty or null sharing metadata in the regular band", () => {
    expect(ids([
      task("null-sharing", { hasSharedAudience: null, isPublic: null, sharedWithUserIds: null }),
      task("empty-sharing", { isPublic: false, sharedWithUserIds: [] }),
      task("shared", { hasSharedAudience: true }),
    ])).toEqual(["shared", "null-sharing", "empty-sharing"])
  })

  it("sorts completed tasks last by completion time regardless of band and hidden state", () => {
    expect(ids([
      task("old-done", { isCompleted: true, priority: TodoPriority.Urgent, hidden: true, completedAt: "2026-04-30T08:00:00.000Z" }),
      task("new-done", { status: TodoStatus.Done, completedAt: "2026-05-01T08:00:00.000Z" }),
      task("regular"),
    ])).toEqual(["regular", "new-done", "old-done"])
  })

  it("preserves equal-key order and does not mutate the input array or tasks", () => {
    const first = Object.freeze(task("first", { hidden: true, hasSharedAudience: true }))
    const second = Object.freeze(task("second", { hidden: true, hasSharedAudience: true }))
    const input = [second, first]
    const sorted = sortTasks(input)
    expect(sorted).not.toBe(input)
    expect(sorted).toEqual([second, first])
    expect(input).toEqual([second, first])
  })
})

describe("keepPlace", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // A hidden High copy follows open High tasks in PRIORITY, ahead of REGULAR tasks.
  const hidden = task("opened", { hidden: true, priority: TodoPriority.High })
  const full = { ...hidden, hidden: false, dueDate: "2026-04-28T00:00:00.000Z" }
  const others = [task("today", { dueDate: "2026-05-01T00:00:00.000Z" }), task("undated", { priority: TodoPriority.Low })]

  it("keeps a card opened from hidden where it was, though its full copy sorts elsewhere", () => {
    expect(sortTasks([...others, full]).map((t) => t.id)).toEqual(["opened", "today", "undated"])
    expect(sortTasks([...others, hidden]).map((t) => t.id)).toEqual(["today", "opened", "undated"])
    const opened = { ...full, heldPlace: keepPlace(hidden, full) }
    expect(sortTasks([...others, opened]).map((t) => t.id)).toEqual(["today", "opened", "undated"])
  })

  it("lets it go where it belongs once anything that places it changes", () => {
    const opened = { ...full, heldPlace: keepPlace(hidden, full) }
    const working = { ...opened, status: TodoStatus.InProgress }
    expect(sortTasks([...others, working]).map((t) => t.id)).toEqual(["opened", "today", "undated"])
  })

  it("keeps the first place across a second opening step — content that arrived late", () => {
    const partial = { ...hidden, hidden: false }
    const first = { ...partial, heldPlace: keepPlace(hidden, partial) }
    const second = { ...full, heldPlace: keepPlace(first, full) }
    // A second reveal keeps the same hidden PRIORITY place, ahead of REGULAR.
    expect(sortTasks([...others, second]).map((t) => t.id)).toEqual(["today", "opened", "undated"])
  })

  it("keeps an urgent card opened from hidden with the urgent ones it was placed with", () => {
    const masked = task("opened", { hidden: true, priority: TodoPriority.Urgent, isVisuallyUrgent: true })
    const shown = { ...masked, hidden: false, dueDate: "2026-05-20T00:00:00.000Z", isVisuallyUrgent: true }
    const opened = { ...shown, heldPlace: keepPlace(masked, shown) }
    expect(sortTasks([...others, opened]).map((t) => t.id)).toEqual(["today", "opened", "undated"])
  })

  it("holds an open place too, when the card it copies was not hidden", () => {
    const open = task("kept", { priority: TodoPriority.High })
    const later = { ...open, dueDate: "2026-04-20T00:00:00.000Z" }
    const held = { ...later, heldPlace: keepPlace(open, later) }
    expect(sortTasks([...others, held]).map((t) => t.id)).toEqual(["today", "kept", "undated"])
  })
})

describe("hidden tasks", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Friday 1 May 2026, noon.
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const ids = (tasks: SortableTask[]) => sortTasks(tasks).map((t) => t.id)
  const overdue = task("overdue", { dueDate: "2026-04-28T00:00:00.000Z" })
  const future = task("future", { dueDate: "2026-05-20T00:00:00.000Z", priority: TodoPriority.Low })
  const undated = task("undated", { priority: TodoPriority.High })
  const urgentUndated = task("urgent-undated", { priority: TodoPriority.Urgent })
  // As the server sends them: no date, the priority and the red frame's flag.
  const hiddenUrgent = task("hidden-urgent", { hidden: true, priority: TodoPriority.Urgent, isVisuallyUrgent: true })
  const hiddenDueToday = task("hidden-due-today", { hidden: true, priority: TodoPriority.Low, isVisuallyUrgent: true })
  const hiddenHigh = task("hidden-high", { hidden: true, priority: TodoPriority.High, isVisuallyUrgent: false })
  const hiddenLow = task("hidden-low", { hidden: true, priority: TodoPriority.Low, isVisuallyUrgent: false })
  const done = task("done", { isCompleted: true, completedAt: "2026-04-30T10:00:00.000Z" })

  it("follow open tasks in their own bands, with High above regular tasks", () => {
    // PRIORITY, including hidden High, precedes REGULAR even when regular tasks have dates.
    expect(ids([hiddenLow, future, hiddenHigh, undated])).toEqual(["undated", "hidden-high", "future", "hidden-low"])
  })

  it("stay above the completed ones", () => {
    expect(ids([done, hiddenLow, future])).toEqual(["future", "hidden-low", "done"])
  })

  it("follow the last open urgent task when they are urgent, ahead of the open tasks after it", () => {
    expect(ids([hiddenLow, future, hiddenUrgent, overdue, undated])).toEqual([
      "overdue",
      "hidden-urgent",
      "undated",
      "future",
      "hidden-low",
    ])
  })

  it("never go ahead of an open urgent task, wherever the smart sort puts it", () => {
    // URGENT is contiguous; its undated open task precedes hidden urgency and other bands.
    expect(ids([hiddenDueToday, urgentUndated, future, overdue, hiddenUrgent, undated])).toEqual([
      "overdue",
      "urgent-undated",
      "hidden-urgent",
      "hidden-due-today",
      "undated",
      "future",
    ])
  })

  it("lead lower bands even while nothing open is urgent", () => {
    // Hidden URGENT no longer needs an open urgent card to precede PRIORITY.
    expect(ids([hiddenHigh, hiddenUrgent, future, undated])).toEqual(["hidden-urgent", "undated", "hidden-high", "future"])
  })

  it("count urgency the way the card draws it: the server's flag first, else the card's rule", () => {
    // No flag: Urgent, overdue and due today are urgent; a High task due tomorrow is not.
    const tomorrow = task("tomorrow", { dueDate: "2026-05-02T00:00:00.000Z", priority: TodoPriority.High })
    // A hidden URGENT task precedes an open PRIORITY task.
    expect(ids([hiddenUrgent, tomorrow])).toEqual(["hidden-urgent", "tomorrow"])
    const dueToday = task("due-today", { dueDate: "2026-05-01T00:00:00.000Z", priority: TodoPriority.Low })
    expect(ids([hiddenUrgent, tomorrow, dueToday])).toEqual(["due-today", "hidden-urgent", "tomorrow"])
    // Server false keeps an Urgent-priority card in PRIORITY, below hidden URGENT.
    const calm = task("calm", { priority: TodoPriority.Urgent, isVisuallyUrgent: false })
    expect(ids([hiddenUrgent, calm, future])).toEqual(["hidden-urgent", "calm", "future"])
    // A hidden task without the flag is urgent by its priority alone.
    const legacy = task("legacy", { hidden: true, priority: TodoPriority.Urgent })
    expect(ids([hiddenHigh, legacy, future])).toEqual(["legacy", "hidden-high", "future"])
  })

  it("keep the in-work tasks first and the hidden in-work ones among the hidden", () => {
    const working = task("working", { status: TodoStatus.InProgress, priority: TodoPriority.Low })
    const hiddenWorking = task("hidden-working", { hidden: true, status: TodoStatus.InProgress, isVisuallyUrgent: false })
    expect(ids([hiddenLow, hiddenWorking, future, working])).toEqual(["working", "future", "hidden-working", "hidden-low"])
  })

  it("keep their input order on equal keys and never mutate the list", () => {
    const a = task("a", { hidden: true, isVisuallyUrgent: false })
    const b = task("b", { hidden: true, isVisuallyUrgent: false })
    const list = [b, a]
    expect(ids(list)).toEqual(["b", "a"])
    expect(list.map((t) => t.id)).toEqual(["b", "a"])
  })
})

describe("getTaskWeight", () => {
  // The card's own geometry: a 42px frame round the body; a title line is 27.5px, the chip
  // row a 12px gap plus 24px. No floor: a sparse card is as short as its content.
  it("weighs a hidden task as its one collapsed row", () => {
    expect(getTaskWeight(task("hidden", { hidden: true }))).toBe(46)
  })

  it("weighs a sparse task as a title and a chip row, with no height floor", () => {
    expect(getTaskWeight(task("plain"))).toBe(42 + 27.5 + 36)
    expect(getTaskWeight(task("short-title", { title: "Short" }))).toBe(42 + 27.5 + 36)
  })

  it("adds title lines (up to three), two description lines, the date and the expected strip", () => {
    expect(
      getTaskWeight(
        task("large", {
          title: "A very long task title that wraps",
          description: "x".repeat(90),
          dueDate: "2026-05-01T00:00:00.000Z",
          expectedDate: "2026-05-02T00:00:00.000Z",
        }),
      ),
    ).toBe(42 + 2 * 27.5 + 36 + (12 + 2 * 20) + (12 + 16) + 57)
    expect(getTaskWeight(task("very-long", { title: "x".repeat(200) }))).toBe(42 + 3 * 27.5 + 36)
  })

  it("does not weigh a status the card does not draw", () => {
    expect(getTaskWeight(task("inprog-only", { status: TodoStatus.InProgress }))).toBe(42 + 27.5 + 36)
  })

  it("weighs a completed task as its title alone, and never hides it as a collapsed row", () => {
    expect(getTaskWeight(task("done", { isCompleted: true, hidden: true, title: "Short" }))).toBe(42 + 32)
  })
})
