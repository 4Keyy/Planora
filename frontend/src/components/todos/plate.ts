/**
 * The two control plates above a task list — the create panel's collapsed header and the
 * quick filter — share these class strings so they cannot drift apart again. They had:
 * one was 86px tall on a desktop and 78px on a phone, the other 74px, with different icon
 * shapes and shadows, stacked one above the other.
 *
 * The row is exactly 80px from `sm` (82px with the border), and the placeholders that hold
 * a plate's place while it loads are built from the same strings, so a plate always lands
 * on the space reserved for it. A plain module so a server component can import it.
 */

/** The plate's surface: a large panel on the scale. */
export const PLATE_SURFACE = "overflow-hidden rounded-xl border border-line bg-paper shadow-sm"

/** The plate's one row: 80px tall from `sm`, the system's gutters. */
export const PLATE_ROW = "flex w-full justify-between gap-4 px-4 sm:h-20 sm:px-5"

/** The ink disc at the start of the row. */
export const PLATE_ICON = "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-ink text-paper"
