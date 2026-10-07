/**
 * What the palette opened last, per account and per device.
 *
 * An empty query is the most common query there is — the palette opened, nothing
 * typed yet — and "the task I had open a minute ago" is the likeliest next stop.
 * Scoped by user id, like the category filter, so two accounts on one browser never
 * see each other's history. Storage can be full, disabled or blocked; every access
 * is guarded and a failure simply means no history.
 */

export type RecentKind = "task" | "screen" | "category" | "person"

export interface RecentEntry {
  kind: RecentKind
  id: string
}

const LIMIT = 8

const keyFor = (userId: string) => `planora:palette-recent:${userId}`

function isEntry(value: unknown): value is RecentEntry {
  if (typeof value !== "object" || value === null) return false
  const entry = value as Partial<RecentEntry>
  return typeof entry.id === "string" && ["task", "screen", "category", "person"].includes(String(entry.kind))
}

export function readRecent(userId: string | null | undefined): RecentEntry[] {
  if (!userId || typeof window === "undefined") return []
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(keyFor(userId)) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, LIMIT) : []
  } catch {
    return []
  }
}

/** Moves `entry` to the front, keeping the list short and free of duplicates. */
export function rememberRecent(userId: string | null | undefined, entry: RecentEntry): void {
  if (!userId || typeof window === "undefined") return
  const next = [entry, ...readRecent(userId).filter((e) => e.kind !== entry.kind || e.id !== entry.id)].slice(0, LIMIT)
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(next))
  } catch {
    // Quota or a blocked store: the palette works without history.
  }
}
