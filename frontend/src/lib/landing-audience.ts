import type { Audience } from "@/components/ui/redaction-badge"

/**
 * The landing page's audience derivation, kept here rather than in the page so the one
 * part that can be wrong in an interesting way is testable. `src/app/**` is excluded
 * from the coverage gate (`vitest.config.ts`); `src/lib/**` is not.
 *
 * The product can never reach `public`: the editor writes `isPublic: false` on every
 * save (`components/todos/edit-todo-modal/utils.ts`), and no route serves a task to an
 * anonymous reader. So this function's range is deliberately `private | shared` — and
 * over that range the redaction arc is monotone, which is the whole point of showing it.
 * Returning `public` here would be the landing page's one outright lie.
 */
export function deriveAudience(viewerCount: number): Audience {
  return normalizeViewerCount(viewerCount) === 0 ? "private" : "shared"
}

/**
 * `RedactionBadge` clamps its own count, but the landing page prints the number beside
 * the mark through its own `NumberRoll` (the badge takes no `minDigits`, and 9 → 10
 * without a reserved column is exactly the 0.119 CLS that `minDigits` was built to fix).
 * Both readings have to agree, so the clamp lives in one place.
 */
export function normalizeViewerCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/**
 * The cut opens from 16% of the circumference and widens 4.5% per viewer, saturating at
 * 50% — past half a circle the mark stops reading as a ring and starts reading as a
 * bracket. Past the ceiling the arc holds still and only the number climbs.
 *
 * The landing page walks the visitor into that ceiling on purpose. Left to find it by
 * themselves they would push the count to ten, watch a motionless arc, and conclude the
 * mark is decorative.
 */
export const SHARING_CEILING = 8

export function isAtSharingCeiling(viewerCount: number): boolean {
  return normalizeViewerCount(viewerCount) >= SHARING_CEILING
}

/** The sentence under the stepper. Two readings, so the ceiling is stated rather than implied. */
export function ceilingCaption(viewerCount: number): string {
  const count = normalizeViewerCount(viewerCount)
  if (count === 0) return "Private — you are the only person who can open this."
  if (count === 1) return "One person can read it. The cut is as narrow as sharing gets."
  if (isAtSharingCeiling(count)) {
    return `${count} people can read it. The mark stopped widening at ${SHARING_CEILING}; only the number is still moving.`
  }
  return `${count} people can read it, and the cut widens with each one.`
}
