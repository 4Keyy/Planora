/**
 * Date and time formatting for the UI, with the locale pinned.
 *
 * Why pinned rather than left to the runtime: every one of these strings is produced twice —
 * once on the server, because the App Router runs force-dynamic (ADR-0006), and once in the
 * browser during hydration. `toLocaleDateString()` with no locale resolves to the *host's*
 * locale, so the server renders `9/13/2026` under the container's C locale while a visitor in
 * Moscow hydrates `13.09.2026`. React then reports a hydration mismatch and silently discards
 * the server pass. Passing an explicit locale makes both passes agree by construction.
 *
 * `en-US` is the product's language: `<html lang="en">` already promises it to assistive
 * technology, and the hand-written month tables elsewhere in the UI are English too. When
 * Planora grows real localisation, this is the single place the choice is made.
 */

/** The one locale the UI formats in. Change it here, nowhere else. */
export const UI_LOCALE = "en-US"

/** `13 Sep 2026, 09:41` — a timestamp precise to the minute. */
export function formatDateTime(value?: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(UI_LOCALE, {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

/** `13 Sep 2026` — a calendar date with no time. */
export function formatDate(value?: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(UI_LOCALE, { day: "numeric", month: "short", year: "numeric" })
}

/**
 * `13 September 2026` — the long form, for a tooltip or an accessible name where the reader
 * has no column width to worry about and an abbreviation would have to be guessed at.
 */
export function formatDateLong(value?: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(UI_LOCALE, { day: "numeric", month: "long", year: "numeric" })
}
