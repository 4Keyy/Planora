import type { MasonryBreakpoint } from "@/components/ui/masonry-columns"

/**
 * One grid for every list of task cards — the dashboard, the task list, the completed
 * preview and the archive. Each page had its own: four columns past 1400px on two of them
 * (in a 1088px column that is 272px per card, three-line titles everywhere), three with a
 * 1200px step on the dashboard. Now all four share the column the app is laid out on:
 * three across from Tailwind's `lg`, two from `sm`, one on a phone. The steps are
 * Tailwind's own, so a CSS grid of skeletons (`sm:grid-cols-2 lg:grid-cols-3`) lays out
 * exactly like the masonry that replaces it. Breakpoints are viewport widths
 * (`MasonryColumns` reads `window.innerWidth`).
 */
export const TASK_GRID_COLUMNS = 3

export const TASK_GRID_BREAKPOINTS: MasonryBreakpoint[] = [
  { maxWidth: 1023, columns: 2 },
  { maxWidth: 639, columns: 1 },
]
