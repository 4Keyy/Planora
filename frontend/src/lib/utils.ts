/**
 * @colour-data — colour-space geometry.
 *
 * The constants below are the WCAG relative-luminance coefficients and sRGB
 * transfer-function breakpoints used to decide whether a user's chosen category
 * colour needs light or dark ink on it. They are arithmetic, not design choices.
 */
import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import { tokens } from "@/lib/design-tokens"

/**
 * tailwind-merge has to be taught the project's scales.
 *
 * Out of the box it treats any unrecognised `text-*` class as a COLOUR (its
 * `text-color` group matches anything), so `cn("text-body-sm", "text-ink-subtle")`
 * looked like two colours in conflict and silently dropped the size. That is a
 * whole-product failure mode with no error and no visual clue at build time —
 * it surfaced as a card description rendering at the inherited size.
 *
 * Every custom scale below must stay in step with `design-tokens.ts`; the names
 * are read from the token object so they cannot drift.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: Object.keys(tokens.fontSize) }],
      "font-weight": [{ font: Object.keys(tokens.fontWeight) }],
      z: [{ z: Object.keys(tokens.layer) }],
      ease: [{ ease: Object.keys(tokens.motion.ease) }],
      duration: [{ duration: Object.keys(tokens.motion.duration) }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NIL_GUID = "00000000-0000-0000-0000-000000000000"

/**
 * True when `value` is a syntactically valid, non-nil GUID/UUID. The all-zero "nil" GUID
 * (`Guid.Empty` on the backend) is rejected because it is the canonical "no value" sentinel and
 * would only ever produce a broken URL. Use this to guard route navigation built from an id
 * (e.g. `/branch/{id}`) so a missing/empty/nil/malformed id never produces a broken URL.
 */
export function isGuid(value: string | null | undefined): value is string {
  return typeof value === "string" && GUID_RE.test(value) && value !== NIL_GUID
}

/**
 * Check if a date is in the past
 */
export function isPastDate(date: string | Date): boolean {
  const checkDate = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  checkDate.setHours(0, 0, 0, 0)
  return checkDate < today
}

/**
 * Format a date to a readable string
 */
export function formatDate(date: string | Date, format: "short" | "long" = "short"): string {
  const d = typeof date === "string" ? new Date(date) : date
  if (format === "short") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + "..."
}

export function formatPublicName(fullName: string | null | undefined): string {
  if (!fullName) return "Unknown"
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  const [firstName, lastName] = parts
  return `${firstName} ${lastName.charAt(0).toUpperCase()}.`
}
