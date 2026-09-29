import type { Todo } from "@/types/todo"
import { CATEGORY_COLOR_SWATCHES } from "@/components/todos/edit-todo-modal/utils"

/**
 * The landing page's task builder, as data.
 *
 * The block lets a visitor name a task and dress it while the product's own `TodoCard`
 * assembles itself. Everything here is pure so the part that could quietly go wrong — the
 * dates — is tested with a fixed clock:
 *
 * - **Dates are computed from the moment of the click, never from a constant.** A fixed
 *   date is overdue from the day it passes, and an overdue card is framed in `alert`, the
 *   product's one saturated colour, spent on nothing. Every option here is in the future.
 * - **Priority names match the card's own vocabulary** (`VeryLow` … `Urgent`), so the
 *   meter the card draws is the one the app would draw.
 * - **Category colours come from `CATEGORY_COLOR_SWATCHES`**, the twelve swatches a user
 *   actually picks from in the editor. Colour here is the user's data, not theme.
 */

export type Level = 1 | 2 | 3 | 4 | 5
export const LEVELS: readonly Level[] = [1, 2, 3, 4, 5]

const PRIORITY_VALUE: Record<Level, string> = {
  1: "VeryLow",
  2: "Low",
  3: "Medium",
  4: "High",
  5: "Urgent",
}

export const PRIORITY_NAME: Record<Level, string> = {
  1: "Whenever",
  2: "Low",
  3: "Medium",
  4: "High",
  5: "Urgent",
}

export type WhenId = "none" | "soon" | "next-week"

export interface WhenOption {
  id: WhenId
  label: string
  dueDate: string | null
  dueDateStart: string | null
}

const DAY = 24 * 60 * 60 * 1000

/** Noon local time on the day `days` from `now`, as ISO — noon so no time zone tips it into the next or previous day. */
function dayFrom(now: Date, days: number): Date {
  const d = new Date(now.getTime() + days * DAY)
  d.setHours(12, 0, 0, 0)
  return d
}

/**
 * The three "when" options. The middle one is labelled with its weekday once the clock is
 * known; before that (the server render) it reads "In three days", which is the same fact.
 */
export function whenOptions(now: Date | null): WhenOption[] {
  const soon = now ? dayFrom(now, 3) : null
  return [
    { id: "none", label: "No date", dueDate: null, dueDateStart: null },
    {
      id: "soon",
      label: soon ? soon.toLocaleDateString("en-US", { weekday: "long" }) : "In three days",
      dueDate: soon ? soon.toISOString() : null,
      dueDateStart: null,
    },
    {
      id: "next-week",
      label: "Next week, any day",
      dueDate: now ? dayFrom(now, 11).toISOString() : null,
      dueDateStart: now ? dayFrom(now, 7).toISOString() : null,
    },
  ]
}

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

export type ShareId = "victoria" | "tom"

export const SHARE_PEOPLE: readonly { id: ShareId; userId: string; firstName: string; lastName: string }[] = [
  { id: "victoria", userId: "fx-1", firstName: "Victoria", lastName: "Whitfield" },
  { id: "tom", userId: "fx-3", firstName: "Tom", lastName: "Achebe" },
]

export const DEFAULT_TITLE = "Repaint the hallway"
export const EMPTY_TITLE = "Name your task"
export const NOTE = "Two coats. Buy the tape first."

export interface BuilderState {
  title: string
  level: Level
  when: WhenId
  category: CategoryId
  share: ShareId[]
  note: boolean
  done: boolean
}

export const INITIAL_BUILDER: BuilderState = {
  title: DEFAULT_TITLE,
  level: 3,
  when: "none",
  category: "none",
  share: [],
  note: false,
  done: false,
}

export const BUILDER_OWNER_ID = "fixture-owner"

/** The `Todo` the card is given. A new object every time, so the memoised card re-renders. */
export function buildTodo(state: BuilderState, now: Date | null): Todo {
  const when = whenOptions(now).find((w) => w.id === state.when) ?? whenOptions(now)[0]
  const category = CATEGORIES.find((c) => c.id === state.category) ?? CATEGORIES[0]
  const sharedWithUserIds = SHARE_PEOPLE.filter((p) => state.share.includes(p.id)).map((p) => p.userId)
  const title = state.title.trim()

  return {
    id: "landing-builder",
    userId: BUILDER_OWNER_ID,
    title: title.length > 0 ? title : EMPTY_TITLE,
    description: state.note ? NOTE : null,
    status: state.done ? "Done" : "Todo",
    priority: PRIORITY_VALUE[state.level],
    isPublic: false,
    isCompleted: state.done,
    tags: [],
    createdAt: "2026-03-02T09:00:00.000Z",
    dueDate: when.dueDate,
    dueDateStart: when.dueDateStart,
    categoryName: category.name,
    categoryIcon: category.icon,
    categoryColor: category.color,
    sharedWithUserIds,
    hasSharedAudience: sharedWithUserIds.length > 0,
  }
}

export type Change = "title" | "priority" | "when" | "category" | "share" | "note" | "done" | "undone"

const EXPLAINERS: Record<Change, string> = {
  title: "It's a task now. Everything else is optional.",
  priority: "Priority is the length of that bar. It reads the same in greyscale.",
  when: "A single day, or a rough range for when you don't know the day yet.",
  category: "Categories are yours: your names, your colours.",
  share: "The ring shows how many people can see it. Only the people you pick.",
  note: "Notes live on the task. Conversations go in its branch.",
  done: "Ticked off. Tick it again to bring it back.",
  undone: "Back on the list.",
}

export const IDLE_EXPLAINER = "Change anything on the left and watch the card."

export function explainerFor(change: Change | null): string {
  return change ? EXPLAINERS[change] : IDLE_EXPLAINER
}
