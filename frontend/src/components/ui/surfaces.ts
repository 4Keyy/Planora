/**
 * The class strings for the product's floating surfaces and the controls inside them.
 *
 * Every dropdown used to carry its own: `rounded-xl border-line/90` with a colour-literal
 * 8px/32px rgba shadow on the account menu, a 12px/40px one on
 * the notifications, a 16px/48px one on the phone sheet — three elevations for one
 * kind of object, none of them on the scale. A plain module rather than a component,
 * so a server component can import the strings (a constant from a `"use client"` module
 * arrives there as a client reference, and `cn()` drops it without a trace).
 */

/** A menu, popover or sheet floating over the page: the `lg` elevation, card radius. */
export const POPOVER_SURFACE = "rounded-lg border border-line bg-paper shadow-lg"

/**
 * One row in a menu: 44px tall, icon then label, the whole row is the target. Real height
 * rather than `.touch-target`: the rows are stacked edge to edge, and each pseudo-element
 * would overlap its neighbour's.
 */
export const MENU_ITEM =
  "flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-body-sm font-medium text-ink-muted transition-colors duration-fast hover:bg-paper-sunken hover:text-ink"

/** A 40px icon-only button in a bar; `.touch-target` lifts its hit area to 44. */
export const ICON_BUTTON =
  "touch-target relative inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
