import type { Todo } from "@/types/todo"
import { CATEGORY_COLOR_SWATCHES } from "@/components/todos/edit-todo-modal/utils"

/**
 * Block 5 of the landing page — one card, five moves — as data.
 *
 * The block puts the product's own `TodoCard` on a stage and gives the visitor five moves,
 * each of which turns on something a user runs into on real cards: a category's colour, a
 * shared audience, urgency, working on it, and finishing it. It replaced a builder with a
 * title field and some twenty buttons; the point was never to make a task, it was to see
 * what a card says at a glance.
 *
 * Kept pure so the parts that can quietly go wrong are tested with a fixed clock:
 *
 * - **Dates come from the moment of the move, never from a constant.** "Overdue" is two
 *   days before the visitor's own today, computed on the client, so it is overdue for them
 *   and nobody else's clock is involved; before the clock is known there is no date.
 * - **Category colours are the swatches users pick from** (`CATEGORY_COLOR_SWATCHES`) —
 *   the colour is the user's data, not theme.
 * - **Sharing is with the page's invented people**, and the count the card shows is theirs.
 */

export type CategoryId = "none" | "home" | "work" | "travel"

export interface CategoryOption {
  id: CategoryId
  name: string | null
  /** A key of `ICON_MAP`. */
  icon: string | null
  color: string | null
}

export const CATEGORIES: readonly CategoryOption[] = [
  { id: "none", name: null, icon: null, color: null },
  { id: "home", name: "Home", icon: "Home", color: CATEGORY_COLOR_SWATCHES[1] },
  { id: "work", name: "Work", icon: "Briefcase", color: CATEGORY_COLOR_SWATCHES[9] },
  { id: "travel", name: "Travel", icon: "Plane", color: CATEGORY_COLOR_SWATCHES[0] },
]

/** Calm is priority 3 with no date; urgent is priority 5; overdue is a date two days gone. */
export type Urgency = "calm" | "urgent" | "overdue"
export const URGENCIES: readonly Urgency[] = ["calm", "urgent", "overdue"]

export const CARD_OWNER_ID = "fixture-owner"
export const CARD_TITLE = "Repaint the hallway"
export const CARD_NOTE = "Two coats. Buy the tape first."
/** The invented people the card is shared with — the page's Victoria and Tom. */
export const SHARED_WITH: readonly string[] = ["fx-1", "fx-3"]

export interface CardState {
  category: CategoryId
  shared: boolean
  urgency: Urgency
  working: boolean
  done: boolean
}

export const INITIAL_CARD: CardState = {
  category: "none",
  shared: false,
  urgency: "calm",
  working: false,
  done: false,
}

/** The next item of a cycle, wrapping. */
function next<T>(items: readonly T[], current: T): T {
  return items[(items.indexOf(current) + 1) % items.length]
}

export function nextCategory(current: CategoryId): CategoryId {
  return next(
    CATEGORIES.map((c) => c.id),
    current
  )
}

export function nextUrgency(current: Urgency): Urgency {
  return next(URGENCIES, current)
}

export function categoryOf(id: CategoryId): CategoryOption {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]
}

const DAY = 24 * 60 * 60 * 1000

/** Noon local time, `days` from `now` — noon so no time zone tips it into another day. */
function noon(now: Date, days: number): string {
  const d = new Date(now.getTime() + days * DAY)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

/** The `Todo` the card is given. A new object every time, so the memoised card re-renders. */
export function buildCard(state: CardState, now: Date | null): Todo {
  const category = categoryOf(state.category)
  const sharedWithUserIds = state.shared ? [...SHARED_WITH] : []
  return {
    id: "landing-card",
    userId: CARD_OWNER_ID,
    title: CARD_TITLE,
    description: CARD_NOTE,
    status: state.done ? "Done" : state.working ? "InProgress" : "Todo",
    priority: state.urgency === "urgent" ? "Urgent" : "Medium",
    isPublic: false,
    isCompleted: state.done,
    tags: [],
    createdAt: "2026-03-02T09:00:00.000Z",
    dueDate: state.urgency === "overdue" && now ? noon(now, -2) : null,
    dueDateStart: null,
    categoryName: category.name,
    categoryIcon: category.icon,
    categoryColor: category.color,
    sharedWithUserIds,
    hasSharedAudience: state.shared,
  }
}

export type Move = "category" | "share" | "urgency" | "work" | "finish"

/** The one sentence under the card: what the move just did, in the card's own terms. */
export function explainMove(move: Move | null, state: CardState): string {
  const category = categoryOf(state.category)
  switch (move) {
    case null:
      return "Five moves, one card. Each one is something you'll meet on real tasks."
    case "category":
      return category.name
        ? `${category.name}: the card wears the category. Hover it, and its shadow glows in that colour.`
        : "No category: the card goes back to plain paper and a grey shadow."
    case "share":
      return state.shared
        ? "Shared with Victoria and Tom: a blue frame, the ring opens for two, and the chip counts who's on it."
        : "Private again: the frame goes back to grey, and only you can see it."
    case "urgency":
      return state.urgency === "urgent"
        ? "Urgent: a full priority bar and the red frame, the one red in the app. It outranks blue."
        : state.urgency === "overdue"
          ? "Two days late: the red frame stays, and the date says so in red."
          : "Calm again: priority three of five, no date, no red."
    case "work": {
      if (!state.working) return "You stepped off it. The check is a plain ring again."
      const check = category.color ? "the check turns the category's colour" : "the check holds a still dot"
      return state.shared ? `You took it: ${check}, and the blue chip counts you in.` : `You took it: ${check}.`
    }
    case "finish":
      return state.done
        ? "Done: a burst, a drawn check, and the card steps back onto grey. Hover it to read the title clearly."
        : "Back on the list, exactly as it was."
  }
}
