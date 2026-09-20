import type { Todo } from "@/types/todo"
import type { PresenceMember } from "@/components/ui/presence-row"

/**
 * Fixtures for the landing page's live demos.
 *
 * These are invented people and invented tasks, and the page says so on screen. The
 * product is not launched: a name here presented as a customer would be fabricated
 * social proof, which is the one thing a page about restraint cannot afford.
 *
 * `avatarUrl` is null on every member on purpose. `Avatar` resolves a relative URL
 * against the API origin (`lib/config.ts`), so a null sends it down the initials
 * fallback and the landing page makes no network request for a decorative face.
 */

export const FIXTURE_OWNER_ID = "fixture-owner"

export type LandingFriend = PresenceMember & { name: string }

/** Eight, because the sharing cut saturates at eight viewers and block 2 walks into it. */
export const FIXTURE_FRIENDS: LandingFriend[] = [
  { id: "fx-1", name: "Dana Whitfield", avatarUrl: null },
  { id: "fx-2", name: "Mira Sandoval", avatarUrl: null },
  { id: "fx-3", name: "Tom Achebe", avatarUrl: null },
  { id: "fx-4", name: "Priya Raman", avatarUrl: null },
  { id: "fx-5", name: "Lev Ostrovsky", avatarUrl: null },
  { id: "fx-6", name: "Nora Lindqvist", avatarUrl: null },
  { id: "fx-7", name: "Kaito Mori", avatarUrl: null },
  { id: "fx-8", name: "Ada Okonkwo", avatarUrl: null },
]

/** The three friends the hero console starts with — enough to open the cut, few enough to read. */
export const HERO_FRIENDS = FIXTURE_FRIENDS.slice(0, 3)

/**
 * A fixed instant, because a landing page rendered on the server and again on the client
 * must agree byte for byte, and `Date.now()` is the classic way to make it not.
 *
 * None of these fixtures carries a due date, and that is deliberate rather than lazy. A
 * hard-coded date is overdue from the moment it passes, so a landing page built on one
 * would show permanently late tasks — two of three cards framed in `alert`, the product's
 * single saturated colour, spent on nothing. Dates are described in prose instead.
 */
const NOW = "2026-03-02T09:00:00.000Z"

function task(partial: Partial<Todo> & Pick<Todo, "id" | "title">): Todo {
  return {
    userId: FIXTURE_OWNER_ID,
    status: "Todo",
    priority: "Medium",
    isPublic: false,
    isCompleted: false,
    tags: [],
    createdAt: NOW,
    ...partial,
  }
}

/** The keyboard console's list. Three rows: enough to move a cursor through, short enough to read. */
export const CONSOLE_TASKS: Todo[] = [
  task({
    id: "fx-task-1",
    title: "Book the flights for the spring trip",
    priority: "High",
    categoryName: "Travel",
    sharedWithUserIds: ["fx-1", "fx-2"],
    hasSharedAudience: true,
  }),
  task({
    id: "fx-task-2",
    title: "Renew the household insurance policy",
    priority: "Urgent",
    categoryName: "Home",
  }),
  task({
    id: "fx-task-3",
    title: "Split last month's shared expenses",
    priority: "Low",
    categoryName: "Money",
    sharedWithUserIds: ["fx-3"],
    hasSharedAudience: true,
  }),
]

/** One task in two projections: what the owner sees, and what a viewer sees. */
export const SHARED_TASK: Todo = task({
  id: "fx-shared",
  title: "Plan the weekend menu and grocery run",
  priority: "Medium",
  categoryName: "Home",
  authorName: "Dana Whitfield",
  sharedWithUserIds: ["fx-viewer"],
  hasSharedAudience: true,
})
