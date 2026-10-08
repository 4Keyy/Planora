import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  SMART_VIEWS,
  byUrgency,
  daysFromToday,
  describeDue,
  fold,
  fuzzyMatch,
  matchTask,
  parseQuery,
  toPaletteTask,
  toRanges,
  type PaletteTask,
} from "@/components/command-palette/search"
import type { Todo } from "@/types/todo"

const ME = "me"
const NOW = new Date(2026, 9, 7, 9, 30) // Wed 7 Oct 2026, local time

/** An ISO instant at local noon, `days` from NOW. */
const day = (days: number) => new Date(2026, 9, 7 + days, 12).toISOString()

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: "t",
    userId: ME,
    title: "A task",
    status: "Todo",
    priority: "Medium",
    isPublic: false,
    isCompleted: false,
    tags: [],
    createdAt: day(-30),
    ...over,
  }
}

function task(over: Partial<PaletteTask> = {}): PaletteTask {
  return {
    id: "t",
    title: "A task",
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
    ownerId: ME,
    ownerName: null,
    sharedWithAll: false,
    sharedWith: [],
    workers: [],
    openSubtasks: 0,
    urgent: false,
    hidden: false,
    keywords: "",
    ...over,
  }
}

describe("fold", () => {
  it("lower-cases and strips accents without changing the length", () => {
    expect(fold("Éclair Café")).toBe("eclair cafe")
    expect(fold("Ёлка")).toBe("елка")
    expect(fold("Straße")).toHaveLength("Straße".length)
  })
})

describe("fuzzyMatch", () => {
  it("prefers a run at the start of a word over one inside a word", () => {
    const m = fuzzyMatch("conflict flights", "fl")
    expect(m?.indices).toEqual([9, 10])
    expect(m!.score).toBeLessThan(6)
  })

  it("falls back to the first run inside a word", () => {
    const m = fuzzyMatch("conflict", "fl")
    expect(m?.indices).toEqual([3, 4])
    expect(m!.score).toBeGreaterThanOrEqual(6)
  })

  it("matches a subsequence and scores it below any run", () => {
    const m = fuzzyMatch("Book the flights", "bfl")
    expect(m?.indices).toEqual([0, 9, 10])
    expect(m!.score).toBeGreaterThanOrEqual(20)
  })

  it("is case- and accent-insensitive", () => {
    expect(fuzzyMatch("Résumé review", "resume")?.indices).toEqual([0, 1, 2, 3, 4, 5])
  })

  it("returns null when the letters are not there in order, and matches everything for an empty needle", () => {
    expect(fuzzyMatch("Book the flights", "xyz")).toBeNull()
    expect(fuzzyMatch("abc", "cba")).toBeNull()
    expect(fuzzyMatch("anything", "")).toEqual({ score: 0, indices: [] })
  })
})

describe("toRanges", () => {
  it("merges adjacent positions into half-open ranges", () => {
    expect(toRanges([4, 0, 1, 2, 7, 8])).toEqual([[0, 3], [4, 5], [7, 9]])
    expect(toRanges([2, 2])).toEqual([[2, 3]])
    expect(toRanges([])).toEqual([])
  })
})

describe("parseQuery", () => {
  it("reads a leading operator and splits the rest into words", () => {
    expect(parseQuery("  #work  stuff ")).toEqual({ narrow: "categories", text: "work  stuff", tokens: ["work", "stuff"] })
    expect(parseQuery("@ada")).toMatchObject({ narrow: "people", tokens: ["ada"] })
    expect(parseQuery(">short")).toMatchObject({ narrow: "shortcuts", tokens: ["short"] })
    expect(parseQuery("plain words")).toMatchObject({ narrow: null, tokens: ["plain", "words"] })
    expect(parseQuery("#")).toEqual({ narrow: "categories", text: "", tokens: [] })
    expect(parseQuery("")).toEqual({ narrow: null, text: "", tokens: [] })
  })
})

describe("matchTask", () => {
  const flights = task({ title: "Book the flights", keywords: fold("Lisbon in April Travel Ada Lovelace") })

  it("requires every word, in the title or as a whole word of the keywords", () => {
    expect(matchTask(flights, ["book", "lisbon"])?.indices).toEqual([0, 1, 2, 3])
    expect(matchTask(flights, ["ada"])).not.toBeNull()
    expect(matchTask(flights, ["book", "paris"])).toBeNull()
  })

  it("never matches the keywords as scattered letters", () => {
    // "lsbn" is a subsequence of "lisbon" but not of the title.
    expect(matchTask(flights, ["lsbn"])).toBeNull()
  })

  it("accepts a scattered match in the title", () => {
    expect(matchTask(flights, ["btf"])?.indices).toEqual([0, 5, 9])
  })

  it("ranks a finished task below an open one", () => {
    const open = matchTask(flights, ["book"])!
    const done = matchTask({ ...flights, completed: true }, ["book"])!
    expect(done.score).toBeGreaterThan(open.score)
  })
})

describe("dates", () => {
  it("counts calendar days in the reader's time zone", () => {
    expect(daysFromToday(day(0), NOW)).toBe(0)
    expect(daysFromToday(day(-1), NOW)).toBe(-1)
    expect(daysFromToday(day(9), NOW)).toBe(9)
    expect(daysFromToday("not a date", NOW)).toBeNull()
  })

  it("words a deadline the way a row reads it", () => {
    expect(describeDue({ dueDate: day(-3), completed: false }, NOW)).toEqual({ label: "3 days late", tone: "alert" })
    expect(describeDue({ dueDate: day(-1), completed: false }, NOW)).toEqual({ label: "Yesterday", tone: "alert" })
    expect(describeDue({ dueDate: day(0), completed: false }, NOW)).toEqual({ label: "Today", tone: "warn" })
    expect(describeDue({ dueDate: day(1), completed: false }, NOW)).toEqual({ label: "Tomorrow", tone: "warn" })
    expect(describeDue({ dueDate: day(3), completed: false }, NOW)).toEqual({ label: "Sat", tone: "muted" })
    expect(describeDue({ dueDate: day(10), completed: false }, NOW)).toEqual({ label: "Oct 17", tone: "muted" })
  })

  it("says nothing for a finished task, a task without a deadline or a broken date", () => {
    expect(describeDue({ dueDate: day(-3), completed: true }, NOW)).toBeNull()
    expect(describeDue({ dueDate: null, completed: false }, NOW)).toBeNull()
    expect(describeDue({ dueDate: "nope", completed: false }, NOW)).toBeNull()
  })
})

describe("SMART_VIEWS", () => {
  const view = (id: string) => SMART_VIEWS.find((v) => v.id === id)!

  it("answers each saved question about the open tasks", () => {
    expect(view("overdue").test(task({ dueDate: day(-1) }), NOW)).toBe(true)
    expect(view("overdue").test(task({ dueDate: day(-1), completed: true }), NOW)).toBe(false)
    expect(view("overdue").test(task(), NOW)).toBe(false)
    expect(view("today").test(task({ dueDate: day(0) }), NOW)).toBe(true)
    expect(view("week").test(task({ dueDate: day(6) }), NOW)).toBe(true)
    expect(view("week").test(task({ dueDate: day(7) }), NOW)).toBe(false)
    expect(view("week").test(task({ dueDate: day(-1) }), NOW)).toBe(false)
    expect(view("progress").test(task({ inProgress: true }), NOW)).toBe(true)
    expect(view("progress").test(task({ workers: [{ id: "w", name: "Ada" }] }), NOW)).toBe(true)
    expect(view("progress").test(task(), NOW)).toBe(false)
    expect(view("shared").test(task({ mine: false }), NOW)).toBe(true)
    expect(view("shared").test(task({ sharedWithAll: true }), NOW)).toBe(true)
    expect(view("shared").test(task({ sharedWith: ["ada"] }), NOW)).toBe(true)
    expect(view("shared").test(task(), NOW)).toBe(false)
    expect(view("urgent").test(task({ priority: 5 }), NOW)).toBe(true)
    expect(view("urgent").test(task({ urgent: true }), NOW)).toBe(true)
    expect(view("urgent").test(task({ priority: 5, completed: true }), NOW)).toBe(false)
  })
})

describe("byUrgency", () => {
  it("orders by deadline, undated last, then by priority", () => {
    const late = task({ id: "late", dueDate: day(-2) })
    const soon = task({ id: "soon", dueDate: day(1), priority: 1 })
    const sameDayHigh = task({ id: "high", dueDate: day(1), priority: 5 })
    const undated = task({ id: "undated", priority: 5 })
    const sorted = [undated, soon, late, sameDayHigh].sort(byUrgency).map((t) => t.id)
    expect(sorted).toEqual(["late", "high", "soon", "undated"])
  })
})

describe("toPaletteTask", () => {
  const names = new Map([["ada", "Ada Lovelace"], ["ben", "Ben Okri"]])

  it("reads the API's spelling of the status and the worker ids of a list read", () => {
    const t = toPaletteTask(todo({ status: "In Progress", workerUserIds: ["ben", ME] }), ME, names)
    expect(t.inProgress).toBe(true)
    expect(t.workers).toEqual([{ id: "ben", name: "Ben Okri" }, { id: ME, name: "You" }])
    expect(t.keywords).toContain("ben okri")
    expect(t.keywords).not.toContain("you")
  })

  it("prefers the names a subtask read carries", () => {
    const t = toPaletteTask(todo({ workers: [{ userId: "ada", name: "Ada L." }] }), ME, names)
    expect(t.workers).toEqual([{ id: "ada", name: "Ada L." }])
  })

  it("names the owner of a task a friend shared, and searches by them", () => {
    const shared = toPaletteTask(todo({ userId: "ada", authorName: null, description: "  " }), ME, names)
    expect(shared.mine).toBe(false)
    expect(shared.ownerName).toBe("Ada Lovelace")
    expect(shared.description).toBeNull()
    expect(shared.keywords).toContain("ada lovelace")
  })

  it("maps completion, priority and audience", () => {
    const t = toPaletteTask(
      todo({ status: "Done", priority: "Urgent", isPublic: true, sharedWithUserIds: ["ada"], categoryName: "Café", openSubtaskCount: 2, isVisuallyUrgent: true }),
      ME,
      names,
    )
    expect(t).toMatchObject({ completed: true, priority: 5, sharedWithAll: true, sharedWith: ["ada"], openSubtasks: 2, urgent: true })
    expect(t.keywords).toContain("cafe")
  })

  it("keeps whether the viewer hid the task", () => {
    expect(toPaletteTask(todo({ hidden: true }), ME, names).hidden).toBe(true)
    expect(toPaletteTask(todo({}), ME, names).hidden).toBe(false)
  })

  it("treats every task as the viewer's own when nobody is signed in", () => {
    expect(toPaletteTask(todo({ userId: "someone" }), null, names).mine).toBe(true)
  })
})

describe("weekday labels", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("uses the product's locale, not the machine's", () => {
    vi.setSystemTime(NOW)
    expect(describeDue({ dueDate: day(2), completed: false }, new Date())?.label).toBe("Fri")
  })
})
