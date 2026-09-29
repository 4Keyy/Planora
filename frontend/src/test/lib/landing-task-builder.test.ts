import { describe, expect, it } from "vitest"
import {
  buildTodo,
  CATEGORIES,
  DEFAULT_TITLE,
  EMPTY_TITLE,
  explainerFor,
  IDLE_EXPLAINER,
  INITIAL_BUILDER,
  NOTE,
  PRIORITY_NAME,
  whenOptions,
} from "@/lib/landing-task-builder"
import { CATEGORY_COLOR_SWATCHES } from "@/components/todos/edit-todo-modal/utils"

const friday = new Date("2026-10-02T08:30:00")
const sunday = new Date("2026-10-04T23:10:00")
const newYearsEve = new Date("2026-12-29T15:00:00")

describe("whenOptions", () => {
  it("labels the near option with its weekday, three days out", () => {
    expect(whenOptions(friday)[1].label).toBe("Monday")
    expect(whenOptions(sunday)[1].label).toBe("Wednesday")
  })

  it("says the same fact in words before the clock is known", () => {
    const [none, soon, range] = whenOptions(null)
    expect(none.label).toBe("No date")
    expect(soon.label).toBe("In three days")
    expect(soon.dueDate).toBeNull()
    expect(range.dueDate).toBeNull()
  })

  it("only ever produces future dates, so the card is never framed as overdue", () => {
    for (const now of [friday, sunday, newYearsEve]) {
      for (const option of whenOptions(now)) {
        for (const iso of [option.dueDate, option.dueDateStart]) {
          if (iso) expect(new Date(iso).getTime()).toBeGreaterThan(now.getTime())
        }
      }
    }
  })

  it("makes a range that starts a week out and ends four days later, across a year", () => {
    const range = whenOptions(newYearsEve)[2]
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

  it("reflects completion", () => {
    const todo = buildTodo({ ...INITIAL_BUILDER, done: true }, friday)
    expect(todo.isCompleted).toBe(true)
    expect(todo.status).toBe("Done")
  })
})

describe("explainerFor", () => {
  it("invites a first move, then explains whatever changed last", () => {
    expect(explainerFor(null)).toBe(IDLE_EXPLAINER)
    expect(explainerFor("priority")).toContain("greyscale")
    expect(explainerFor("share")).toContain("Only the people you pick")
    expect(explainerFor("note")).toContain("branch")
  })
})
