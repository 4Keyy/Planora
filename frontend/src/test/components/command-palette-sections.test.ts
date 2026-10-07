import { describe, expect, it } from "vitest"
import { fold, parseQuery, type PaletteTask } from "@/components/command-palette/search"
import {
  ACTIONS,
  SCREENS,
  buildSections,
  countMatches,
  countViews,
  flatten,
  inScope,
  type BuildInput,
  type PaletteCategory,
  type PalettePerson,
  type Scope,
} from "@/components/command-palette/sections"

const NOW = new Date(2026, 9, 7, 9, 30)
const day = (days: number) => new Date(2026, 9, 7 + days, 12).toISOString()

function task(over: Partial<PaletteTask> & { id: string; title: string }): PaletteTask {
  return {
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
    keywords: fold([over.description, over.categoryName].filter(Boolean).join(" ")),
    ...over,
  }
}

const TASKS: PaletteTask[] = [
  task({ id: "flights", title: "Book the flights", categoryId: "travel", categoryName: "Travel", dueDate: day(5) }),
  task({ id: "bank", title: "Call the bank", dueDate: day(-2), priority: 5 }),
  task({ id: "bills", title: "Pay bills", dueDate: day(0), sharedWith: ["ada"] }),
  task({ id: "hotel", title: "Book a hotel", categoryId: "travel", categoryName: "Travel" }),
  task({ id: "report", title: "Quarterly report", ownerId: "ada", mine: false, ownerName: "Ada" }),
  task({ id: "milk", title: "Buy milk", completed: true, completedAt: day(-1), categoryId: "travel" }),
  task({ id: "gym", title: "Gym", completed: true, completedAt: day(-3) }),
]

const CATEGORIES: PaletteCategory[] = [
  { id: "travel", name: "Travel", description: "Trips", color: "#0ea5e9", icon: "Plane", open: 2 },
  { id: "home", name: "Home", description: null, color: null, icon: null, open: 0 },
]

const PEOPLE: PalettePerson[] = [
  { id: "ada", name: "Ada Lovelace", email: "ada@example.test", avatar: null, shared: 2 },
  { id: "ben", name: "Ben Okri", email: "ben@books.test", avatar: null, shared: 0 },
]

function input(over: Partial<BuildInput> & { q?: string } = {}): BuildInput {
  const { q = "", ...rest } = over
  return { query: parseQuery(q), tab: "all", scope: null, tasks: TASKS, categories: CATEGORIES, people: PEOPLE, recent: [], now: NOW, ...rest }
}

const ids = (sections: ReturnType<typeof buildSections>) => sections.map((s) => s.id)
const keys = (sections: ReturnType<typeof buildSections>) => flatten(sections).map((i) => i.key)

describe("buildSections — nothing typed", () => {
  it("shows Up next by deadline, then the actions and the screens", () => {
    const sections = buildSections(input())
    expect(ids(sections)).toEqual(["next", "actions", "screens"])
    expect(sections[0].items.map((i) => i.task?.id)).toEqual(["bank", "bills", "flights", "hotel", "report"])
    expect(sections[1].items.map((i) => i.key)).toEqual(ACTIONS.map((a) => `action:${a.id}`))
    expect(sections[2].items).toHaveLength(SCREENS.length)
  })

  it("puts what was opened last first, and keeps it out of Up next", () => {
    const sections = buildSections(input({
      recent: [
        { kind: "task", id: "flights" },
        { kind: "task", id: "deleted-since" },
        { kind: "screen", id: "categories" },
        { kind: "category", id: "travel" },
        { kind: "person", id: "ada" },
        { kind: "screen", id: "profile" },
      ],
    }))
    expect(ids(sections)).toEqual(["recent", "next", "actions", "screens"])
    expect(sections[0].items.map((i) => i.key)).toEqual(["task:flights", "screen:categories", "category:travel", "person:ada"])
    expect(sections[1].items.map((i) => i.key)).not.toContain("task:flights")
  })

  it("lists one kind per tab", () => {
    const tasks = buildSections(input({ tab: "tasks" }))
    expect(ids(tasks)).toEqual(["open", "done"])
    // Recently done, newest first.
    expect(tasks[1].items.map((i) => i.task?.id)).toEqual(["milk", "gym"])
    expect(keys(buildSections(input({ tab: "categories" })))).toEqual(["category:travel", "category:home"])
    expect(keys(buildSections(input({ tab: "people" })))).toEqual(["person:ada", "person:ben"])
    expect(ids(buildSections(input({ tab: "commands" })))).toEqual(["views", "actions", "screens"])
  })

  it("returns nothing for an empty kind", () => {
    expect(buildSections(input({ tab: "categories", categories: [] }))).toEqual([])
    expect(buildSections(input({ tab: "people", people: [] }))).toEqual([])
    expect(buildSections(input({ tab: "tasks", tasks: [] }))).toEqual([])
  })

  it("treats a bare operator as its tab", () => {
    expect(keys(buildSections(input({ q: "#" })))).toEqual(["category:travel", "category:home"])
    expect(keys(buildSections(input({ q: "@" })))).toEqual(["person:ada", "person:ben"])
  })
})

describe("buildSections — searching", () => {
  it("ranks the group with the best match first and ends with an offer to create", () => {
    const sections = buildSections(input({ q: "trav" }))
    expect(ids(sections)).toEqual(["categories", "tasks", "create"])
    expect(sections[0].items[0]).toMatchObject({ key: "category:travel", indices: [0, 1, 2, 3] })
    // Tasks match "trav" through their category name.
    expect(sections[1].items.map((i) => i.task?.id)).toEqual(["flights", "hotel"])
    expect(sections.at(-1)!.items[0]).toMatchObject({ kind: "create", label: "Create task “trav”", action: { type: "capture", title: "trav" } })
  })

  it("finds people by name or by email, and commands by label or hint", () => {
    expect(keys(buildSections(input({ q: "@lovelace" })))).toEqual(["person:ada"])
    expect(keys(buildSections(input({ q: "@books" })))).toEqual(["person:ben"])
    const commands = buildSections(input({ q: ">archive" }))
    expect(keys(commands)).toEqual(["screen:completed"])
    expect(flatten(commands)[0].indices).toEqual([])
    expect(keys(buildSections(input({ q: ">overdue" })))).toEqual(["view:overdue"])
    // A hint matches as a whole fragment, never as letters scattered through it.
    expect(keys(buildSections(input({ q: ">every key" })))).toEqual(["action:shortcuts"])
    expect(keys(buildSections(input({ q: ">trav" })))).toEqual([])
    expect(keys(buildSections(input({ q: ">capture" })))).toEqual(["action:capture"])
  })

  it("does not offer to create from a narrowed search or a non-task tab", () => {
    expect(ids(buildSections(input({ q: "#zzz" })))).toEqual([])
    expect(ids(buildSections(input({ q: "zzz", tab: "people" })))).toEqual([])
    expect(ids(buildSections(input({ q: "zzz", tab: "tasks" })))).toEqual(["create"])
  })

  it("keeps a few of each kind in All and reports how many matched", () => {
    const many = Array.from({ length: 9 }, (_, i) => task({ id: `b${i}`, title: `Book ${i}` }))
    const all = buildSections(input({ q: "book", tasks: many }))
    expect(all[0]).toMatchObject({ id: "tasks", total: 9 })
    expect(all[0].items).toHaveLength(6)
    const one = buildSections(input({ q: "book", tasks: many, tab: "tasks" }))
    expect(one[0].items).toHaveLength(9)
  })

  it("counts matches per tab, and nothing with nothing typed", () => {
    expect(countMatches(input())).toBeNull()
    // Ben matches by his email address.
    expect(countMatches(input({ q: "book" }))).toEqual({ tasks: 2, categories: 0, people: 1, commands: 0 })
    expect(countMatches(input({ q: "o" }))).toMatchObject({ categories: 1, people: 2 })
  })
})

describe("buildSections — narrowed", () => {
  const travel: Scope = { kind: "category", id: "travel", label: "Travel", color: null, icon: null }

  it("lists a scope's open tasks by deadline, then the finished ones", () => {
    const sections = buildSections(input({ scope: travel }))
    expect(sections.map((s) => [s.id, s.items.map((i) => i.task?.id)])).toEqual([
      ["scoped-open", ["flights", "hotel"]],
      ["scoped-done", ["milk"]],
    ])
  })

  it("searches inside the scope only, and still offers to create", () => {
    const sections = buildSections(input({ scope: travel, q: "hotel" }))
    expect(sections.map((s) => s.id)).toEqual(["scoped", "create"])
    expect(sections[0].items.map((i) => i.task?.id)).toEqual(["hotel"])
    expect(ids(buildSections(input({ scope: travel, q: "bank" })))).toEqual(["create"])
  })

  it("returns nothing for an empty scope", () => {
    expect(buildSections(input({ scope: { kind: "category", id: "home", label: "Home", color: null, icon: null } }))).toEqual([])
  })
})

describe("inScope", () => {
  it("matches a category, the people on a task and a view", () => {
    const [flights, bank, bills, , report] = TASKS
    expect(inScope(flights, { kind: "category", id: "travel", label: "", color: null, icon: null }, NOW)).toBe(true)
    const ada: Scope = { kind: "person", id: "ada", label: "Ada", avatar: null }
    expect(inScope(bills, ada, NOW)).toBe(true)
    expect(inScope(report, ada, NOW)).toBe(true)
    expect(inScope({ ...flights, workers: [{ id: "ada", name: "Ada" }] }, ada, NOW)).toBe(true)
    expect(inScope(flights, ada, NOW)).toBe(false)
    expect(inScope(bank, { kind: "view", id: "overdue", label: "Overdue" }, NOW)).toBe(true)
    expect(inScope(bank, { kind: "view", id: "nope" as "overdue", label: "?" }, NOW)).toBe(false)
  })
})

describe("countViews", () => {
  it("counts each view over the tasks", () => {
    const counts = Object.fromEntries(countViews(TASKS, NOW).map((v) => [v.id, v.count]))
    expect(counts).toEqual({ overdue: 1, today: 1, week: 2, progress: 0, shared: 2, urgent: 1 })
  })
})
