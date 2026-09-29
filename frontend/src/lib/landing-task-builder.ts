import type { Todo } from "@/types/todo"
import { CATEGORY_COLOR_SWATCHES } from "@/components/todos/edit-todo-modal/utils"

/**
 * The landing page's task builder, as data.
 *
 * The block lets a visitor name a task and dress it while the product's own `TodoCard`
 * assembles itself, and a legend under the card lights up for every signal the card is
 * showing. Everything here is pure so the parts that could quietly go wrong — the dates and
 * which signals are lit — are tested with a fixed clock:
 *
 * - **Dates are computed from the moment of the click, never from a constant.** A fixed
 *   date goes overdue from the day it passes. "Today" is the one option that frames the
 *   card in `alert`, and it does so on purpose: that red frame is one of the signals the
 *   block exists to show, and a task due today is exactly what the product spends it on.
 * - **Priority names match the card's own vocabulary** (`VeryLow` … `Urgent`), so the
 *   meter the card draws is the one the app would draw.
 * - **Category colours come from `CATEGORY_COLOR_SWATCHES`**, the twelve swatches a user
 *   actually picks from in the editor. Colour here is the user's data, not theme.
 * - **The share picker mirrors the product's.** "All friends" is the public setting and
 *   clears the named people; naming a person leaves "All friends" — the same semantics as
 *   the create panel's `SharePopover`.
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

export type WhenId = "none" | "today" | "soon" | "next-week"

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
 * The four "when" options. The third is labelled with its weekday once the clock is known;
 * before that (the server render) it reads "In three days", which is the same fact.
 */
export function whenOptions(now: Date | null): WhenOption[] {
  const soon = now ? dayFrom(now, 3) : null
  return [
    { id: "none", label: "No date", dueDate: null, dueDateStart: null },
    { id: "today", label: "Today", dueDate: now ? dayFrom(now, 0).toISOString() : null, dueDateStart: null },
    {
      id: "soon",
      label: soon ? soon.toLocaleDateString("en-US", { weekday: "long" }) : "In three days",
      dueDate: soon ? soon.toISOString() : null,
      dueDateStart: null,
    },
    {
      id: "next-week",
      label: "Next week",
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

/** Where the task stands for its owner. "Working" is the product's "In progress". */
export type StatusId = "todo" | "working" | "done"

export const STATUSES: readonly { id: StatusId; label: string }[] = [
  { id: "todo", label: "Not started" },
  { id: "working", label: "In progress" },
  { id: "done", label: "Done" },
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
  /** The share picker's "All friends" — the product's public setting. */
  allFriends: boolean
  note: boolean
  status: StatusId
}

export const INITIAL_BUILDER: BuilderState = {
  title: DEFAULT_TITLE,
  level: 3,
  when: "none",
  category: "none",
  share: [],
  allFriends: false,
  note: false,
  status: "todo",
}

export const BUILDER_OWNER_ID = "fixture-owner"

/** Naming a person leaves "All friends", like the product's share picker. */
export function togglePerson(state: BuilderState, id: ShareId): Pick<BuilderState, "share" | "allFriends"> {
  const share = state.share.includes(id) ? state.share.filter((x) => x !== id) : [...state.share, id]
  return { share, allFriends: false }
}

/** "All friends" clears the named people on the way in. */
export function toggleAllFriends(state: BuilderState): Pick<BuilderState, "share" | "allFriends"> {
  return state.allFriends ? { share: state.share, allFriends: false } : { share: [], allFriends: true }
}

const STATUS_VALUE: Record<StatusId, string> = { todo: "Todo", working: "InProgress", done: "Done" }

/** The `Todo` the card is given. A new object every time, so the memoised card re-renders. */
export function buildTodo(state: BuilderState, now: Date | null): Todo {
  const options = whenOptions(now)
  const when = options.find((w) => w.id === state.when) ?? options[0]
  const category = CATEGORIES.find((c) => c.id === state.category) ?? CATEGORIES[0]
  const sharedWithUserIds = state.allFriends
    ? []
    : SHARE_PEOPLE.filter((p) => state.share.includes(p.id)).map((p) => p.userId)
  const title = state.title.trim()

  return {
    id: "landing-builder",
    userId: BUILDER_OWNER_ID,
    title: title.length > 0 ? title : EMPTY_TITLE,
    description: state.note ? NOTE : null,
    status: STATUS_VALUE[state.status],
    priority: PRIORITY_VALUE[state.level],
    isPublic: state.allFriends,
    isCompleted: state.status === "done",
    tags: [],
    createdAt: "2026-03-02T09:00:00.000Z",
    dueDate: when.dueDate,
    dueDateStart: when.dueDateStart,
    categoryName: category.name,
    categoryIcon: category.icon,
    categoryColor: category.color,
    sharedWithUserIds,
    hasSharedAudience: state.allFriends || sharedWithUserIds.length > 0,
  }
}

/**
 * The signals a card can show, in the order the eye meets them. Each one is a fact the card
 * draws in a way of its own — a frame, a length, a shape, a tint, a surface — and the legend
 * under the card lights exactly the ones this card is showing now.
 */
export type SignalId = "frame" | "meter" | "ring" | "work" | "done"

export interface SignalInfo {
  id: SignalId
  name: string
  line: string
}

export const SIGNALS: readonly SignalInfo[] = [
  {
    id: "frame",
    name: "Red frame",
    line: "Urgent, due today, or overdue. The only red in the app.",
  },
  {
    id: "meter",
    name: "Priority bar",
    line: "How much it matters, as a length rather than a colour.",
  },
  {
    id: "ring",
    name: "The ring",
    line: "Who can see it. Opens per person, closes for all friends.",
  },
  {
    id: "work",
    name: "In progress",
    line: "The check takes the category's colour; shared tasks add a blue chip.",
  },
  {
    id: "done",
    name: "Done",
    line: "Steps back onto grey paper, its title struck through.",
  },
]

/** Which signals the card built from this state is showing — the same rules `TodoCard` draws by. */
export function litSignals(state: BuilderState, now: Date | null): Record<SignalId, boolean> {
  const done = state.status === "done"
  const dueToday = state.when === "today" && now !== null
  return {
    frame: !done && (state.level === 5 || dueToday),
    meter: !done,
    ring: !done && (state.allFriends || state.share.length > 0),
    work: !done && state.status === "working",
    done,
  }
}

export type Change =
  | "title"
  | "priority"
  | "urgent"
  | "when"
  | "today"
  | "category"
  | "share"
  | "public"
  | "note"
  | "fold"
  | "unfold"
  | "working"
  | "todo"
  | "done"
  | "undone"

const EXPLAINERS: Record<Change, string> = {
  title: "It's a task now. Everything else is optional.",
  priority: "Priority is the length of that bar, not a colour.",
  urgent: "Urgent gets the red frame. So does anything due today.",
  when: "A single day, or a rough range for when you don't know the day yet.",
  today: "Due today, so the frame turns red until it's done.",
  category: "Categories are yours: your names, your colours.",
  share: "The ring opens for each person you pick, and only for them.",
  public: "All friends closes the ring. Still nobody outside your friends.",
  note: "Notes live on the task. Conversations go in its branch.",
  fold: "Folded away to one line. Press the card to open it again.",
  unfold: "Open again, exactly as it was.",
  working: "In progress: the check wears the category's colour.",
  todo: "Back to not started.",
  done: "Ticked off. Tick it again to bring it back.",
  undone: "Back on the list.",
}

export const IDLE_EXPLAINER = "Change anything and watch the card, and the legend under it."

export function explainerFor(change: Change | null): string {
  return change ? EXPLAINERS[change] : IDLE_EXPLAINER
}
