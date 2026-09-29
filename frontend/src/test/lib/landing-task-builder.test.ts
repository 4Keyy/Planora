import { describe, expect, it } from "vitest"
import {
  buildTodo,
  CATEGORIES,
  DEFAULT_TITLE,
  EMPTY_TITLE,
  explainerFor,
  IDLE_EXPLAINER,
  INITIAL_BUILDER,
  litSignals,
  NOTE,
  PRIORITY_NAME,
  toggleAllFriends,
  togglePerson,
  whenOptions,
} from "@/lib/landing-task-builder"
import { CATEGORY_COLOR_SWATCHES } from "@/components/todos/edit-todo-modal/utils"

const friday = new Date("2026-10-02T08:30:00")
const sunday = new Date("2026-10-04T23:10:00")
const newYearsEve = new Date("2026-12-29T15:00:00")

describe("whenOptions", () => {
  it("labels the near option with its weekday, three days out", () => {
    expect(whenOptions(friday)[2].label).toBe("Monday")
    expect(whenOptions(sunday)[2].label).toBe("Wednesday")
  })

  it("says the same fact in words before the clock is known", () => {
    const [none, today, soon, range] = whenOptions(null)
    expect(none.label).toBe("No date")
    expect(today.label).toBe("Today")
    expect(today.dueDate).toBeNull()
    expect(soon.label).toBe("In three days")
    expect(soon.dueDate).toBeNull()
    expect(range.dueDate).toBeNull()
  })

  it("puts Today on today, so the card is due rather than overdue", () => {
    const due = new Date(whenOptions(sunday)[1].dueDate as string)
    expect(due.toDateString()).toBe(sunday.toDateString())
  })

  it("never produces a date before today, so the card is never framed as overdue", () => {
    for (const now of [friday, sunday, newYearsEve]) {
      const startOfToday = new Date(now)
      startOfToday.setHours(0, 0, 0, 0)
      for (const option of whenOptions(now)) {
        for (const iso of [option.dueDate, option.dueDateStart]) {
          if (iso) expect(new Date(iso).getTime()).toBeGreaterThanOrEqual(startOfToday.getTime())
        }
      }
    }
  })

  it("makes a range that starts a week out and ends four days later, across a year", () => {
    const range = whenOptions(newYearsEve)[3]
    const start = new Date(range.dueDateStart as string)
    const end = new Date(range.dueDate as string)
    expect(start.getFullYear()).toBe(2027)
    expect(Math.round((end.getTime() - start.getTime()) / 86_400_000)).toBe(4)
    expect(start.getHours()).toBe(12)
  })
})

describe("buildTodo", () => {
  it("starts as a plain private task with the default title", () => {
    const todo = buildTodo(INITIAL_BUILDER, friday)
    expect(todo.title).toBe(DEFAULT_TITLE)
    expect(todo.priority).toBe("Medium")
    expect(todo.isPublic).toBe(false)
    expect(todo.hasSharedAudience).toBe(false)
    expect(todo.dueDate).toBeNull()
    expect(todo.description).toBeNull()
  })

  it("never shows an empty card", () => {
    expect(buildTodo({ ...INITIAL_BUILDER, title: "   " }, friday).title).toBe(EMPTY_TITLE)
  })

  it("maps each level to the card's own priority vocabulary", () => {
    const values = ([1, 2, 3, 4, 5] as const).map((level) => buildTodo({ ...INITIAL_BUILDER, level }, null).priority)
    expect(values).toEqual(["VeryLow", "Low", "Medium", "High", "Urgent"])
    expect(PRIORITY_NAME[1]).toBe("Whenever")
  })

  it("dresses the card with a date, a category, an audience and a note", () => {
    const todo = buildTodo(
      { ...INITIAL_BUILDER, when: "next-week", category: "home", share: ["victoria", "tom"], note: true },
      friday,
    )
    expect(todo.dueDateStart).not.toBeNull()
    expect(todo.categoryName).toBe("Home")
    expect(todo.categoryIcon).toBe("Home")
    expect(todo.sharedWithUserIds).toEqual(["fx-1", "fx-3"])
    expect(todo.hasSharedAudience).toBe(true)
    expect(todo.description).toBe(NOTE)
  })

  it("takes category colours from the swatches users pick from", () => {
    for (const c of CATEGORIES.filter((x) => x.color)) {
      expect(CATEGORY_COLOR_SWATCHES).toContain(c.color)
    }
  })

  it("is a new object every time, so the memoised card re-renders", () => {
    expect(buildTodo(INITIAL_BUILDER, friday)).not.toBe(buildTodo(INITIAL_BUILDER, friday))
  })

  it("reflects where the task stands, in the card's own status vocabulary", () => {
    const done = buildTodo({ ...INITIAL_BUILDER, status: "done" }, friday)
    expect(done.isCompleted).toBe(true)
    expect(done.status).toBe("Done")
    const working = buildTodo({ ...INITIAL_BUILDER, status: "working" }, friday)
    expect(working.isCompleted).toBe(false)
    expect(working.status).toBe("InProgress")
  })

  it("makes All friends the public setting, with nobody named", () => {
    const todo = buildTodo({ ...INITIAL_BUILDER, allFriends: true, share: ["tom"] }, friday)
    expect(todo.isPublic).toBe(true)
    expect(todo.sharedWithUserIds).toEqual([])
    expect(todo.hasSharedAudience).toBe(true)
  })
})

describe("the share picker", () => {
  it("clears the named people when All friends goes on, like the product's picker", () => {
    const named = { ...INITIAL_BUILDER, share: ["victoria" as const] }
    expect(toggleAllFriends(named)).toEqual({ share: [], allFriends: true })
  })

  it("leaves All friends when a person is named", () => {
    const everyone = { ...INITIAL_BUILDER, allFriends: true }
    expect(togglePerson(everyone, "tom")).toEqual({ share: ["tom"], allFriends: false })
    expect(togglePerson({ ...INITIAL_BUILDER, share: ["tom"] }, "tom")).toEqual({ share: [], allFriends: false })
  })
})

describe("litSignals", () => {
  it("lights only the priority bar on a plain task", () => {
    expect(litSignals(INITIAL_BUILDER, friday)).toEqual({
      frame: false,
      meter: true,
      ring: false,
      work: false,
      done: false,
    })
  })

  it("frames an urgent task, and one due today once the clock is known", () => {
    expect(litSignals({ ...INITIAL_BUILDER, level: 5 }, friday).frame).toBe(true)
    expect(litSignals({ ...INITIAL_BUILDER, when: "today" }, friday).frame).toBe(true)
    expect(litSignals({ ...INITIAL_BUILDER, when: "today" }, null).frame).toBe(false)
  })

  it("lights the ring for named people and for all friends", () => {
    expect(litSignals({ ...INITIAL_BUILDER, share: ["tom"] }, friday).ring).toBe(true)
    expect(litSignals({ ...INITIAL_BUILDER, allFriends: true }, friday).ring).toBe(true)
  })

  it("puts a finished task's other signals out, as the card does", () => {
    const lit = litSignals({ ...INITIAL_BUILDER, level: 5, share: ["tom"], status: "done" }, friday)
    expect(lit).toEqual({ frame: false, meter: false, ring: false, work: false, done: true })
  })

  it("lights in progress only while the task is open", () => {
    expect(litSignals({ ...INITIAL_BUILDER, status: "working" }, friday).work).toBe(true)
  })
})

describe("explainerFor", () => {
  it("invites a first move, then explains whatever changed last", () => {
    expect(explainerFor(null)).toBe(IDLE_EXPLAINER)
    expect(explainerFor("priority")).toContain("length")
    expect(explainerFor("urgent")).toContain("red frame")
    expect(explainerFor("share")).toContain("only for them")
    expect(explainerFor("public")).toContain("nobody outside your friends")
    expect(explainerFor("note")).toContain("branch")
  })
})
