import { describe, expect, it } from "vitest"
import {
  buildCard,
  CATEGORIES,
  categoryOf,
  explainMove,
  INITIAL_CARD,
  nextCategory,
  nextUrgency,
  SHARED_WITH,
} from "@/lib/landing-card"
import { CATEGORY_COLOR_SWATCHES } from "@/components/todos/edit-todo-modal/utils"

const friday = new Date("2026-10-02T08:30:00")

describe("the cycles", () => {
  it("walks the categories and wraps back to none", () => {
    const seen = [INITIAL_CARD.category]
    for (let i = 0; i < CATEGORIES.length; i++) seen.push(nextCategory(seen[seen.length - 1]))
    expect(seen).toEqual(["none", "home", "work", "travel", "none"])
  })

  it("walks urgency calm → urgent → overdue → calm", () => {
    expect(nextUrgency("calm")).toBe("urgent")
    expect(nextUrgency("urgent")).toBe("overdue")
    expect(nextUrgency("overdue")).toBe("calm")
  })

  it("takes category colours from the swatches users pick from", () => {
    for (const c of CATEGORIES.filter((x) => x.color)) expect(CATEGORY_COLOR_SWATCHES).toContain(c.color)
    expect(categoryOf("work").icon).toBe("Briefcase")
  })
})

describe("buildCard", () => {
  it("starts as a calm private task with its note", () => {
    const todo = buildCard(INITIAL_CARD, friday)
    expect(todo.priority).toBe("Medium")
    expect(todo.hasSharedAudience).toBe(false)
    expect(todo.sharedWithUserIds).toEqual([])
    expect(todo.dueDate).toBeNull()
    expect(todo.description).toBeTruthy()
  })

  it("shares with the page's two invented people, never with everyone", () => {
    const todo = buildCard({ ...INITIAL_CARD, shared: true }, friday)
    expect(todo.sharedWithUserIds).toEqual([...SHARED_WITH])
    expect(todo.hasSharedAudience).toBe(true)
    expect(todo.isPublic).toBe(false)
  })

  it("makes urgent a full priority, and overdue a date two days before the visitor's today", () => {
    expect(buildCard({ ...INITIAL_CARD, urgency: "urgent" }, friday).priority).toBe("Urgent")
    const due = new Date(buildCard({ ...INITIAL_CARD, urgency: "overdue" }, friday).dueDate as string)
    expect(Math.round((friday.getTime() - due.getTime()) / 86_400_000)).toBe(2)
    expect(due.getHours()).toBe(12)
  })

  it("has no date at all before the clock is known, so the server and client agree", () => {
    expect(buildCard({ ...INITIAL_CARD, urgency: "overdue" }, null).dueDate).toBeNull()
  })

  it("speaks the card's own status vocabulary", () => {
    expect(buildCard({ ...INITIAL_CARD, working: true }, friday).status).toBe("InProgress")
    const done = buildCard({ ...INITIAL_CARD, done: true }, friday)
    expect(done.status).toBe("Done")
    expect(done.isCompleted).toBe(true)
  })

  it("is a new object every time, so the memoised card re-renders", () => {
    expect(buildCard(INITIAL_CARD, friday)).not.toBe(buildCard(INITIAL_CARD, friday))
  })
})

describe("explainMove", () => {
  it("invites the first move", () => {
    expect(explainMove(null, INITIAL_CARD)).toContain("Five moves")
  })

  it("names the category and its glow, and the plain card without one", () => {
    expect(explainMove("category", { ...INITIAL_CARD, category: "home" })).toContain("Home")
    expect(explainMove("category", INITIAL_CARD)).toContain("grey shadow")
  })

  it("says what sharing draws: the blue frame and the ring", () => {
    expect(explainMove("share", { ...INITIAL_CARD, shared: true })).toContain("blue frame")
    expect(explainMove("share", INITIAL_CARD)).toContain("Private again")
  })

  it("says red outranks blue, and says late when it is late", () => {
    expect(explainMove("urgency", { ...INITIAL_CARD, urgency: "urgent" })).toContain("outranks blue")
    expect(explainMove("urgency", { ...INITIAL_CARD, urgency: "overdue" })).toContain("late")
  })

  it("describes the taken check by whether the card has a colour and an audience", () => {
    expect(explainMove("work", { ...INITIAL_CARD, working: true })).toContain("still dot")
    const shared = explainMove("work", { ...INITIAL_CARD, working: true, shared: true, category: "home" })
    expect(shared).toContain("category's colour")
    expect(shared).toContain("blue chip")
  })

  it("describes finishing and bringing it back", () => {
    expect(explainMove("finish", { ...INITIAL_CARD, done: true })).toContain("Done")
    expect(explainMove("finish", INITIAL_CARD)).toContain("Back on the list")
  })
})
