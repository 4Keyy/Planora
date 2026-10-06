"use client"

import { AnimatePresence, useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PLATE_ROW, PLATE_SURFACE, PLATE_ICON } from "@/components/todos/plate"
import { ICON_MAP } from "@/lib/icon-map"
import { SPRING_RESPONSIVE, TWEEN_FAST } from "@/lib/animations"
import { cn } from "@/lib/utils"
import type { Category } from "@/types/category"

interface QuickFilterBarProps {
  categories: Category[]
  /** Currently selected category ids. Empty = no filter. */
  selectedIds: string[]
  /** Open the category filter modal. */
  onOpen: () => void
  /** Clear all selected categories. */
  onClear: () => void
  /**
   * Optional control rendered inside the plate's right-hand cluster — used by /tasks/completed to
   * embed the completion-date filter so it lives *in* the filter bar instead of as a separate block.
   * Anything passed here must manage its own popover/overlay so the plate keeps its height.
   */
  dateControl?: React.ReactNode
}

/**
 * The filter plate shared by /tasks and /tasks/completed, the twin of the create panel's
 * collapsed header directly above it on /tasks: the same surface, the same 80px row, the
 * same ink disc — they read as one pair of controls rather than two widgets that happen
 * to be stacked. (The title used to be the only ALL-CAPS heading on the page, the icon a
 * rounded square with a black 10% shadow, and the button restyled itself black on hover.)
 *
 * The applied-filter summary lives inside the plate and swaps in through a crossfade in a
 * fixed-height subtitle row, so turning a filter on or off never changes the plate's size.
 * On a phone the actions sit on their own row below the title — always, not only when they
 * do not fit — because whether the date control is present depends on data that arrives
 * after the first paint, and a row that wraps on data is a layout shift.
 */
export function QuickFilterBar({ categories, selectedIds, onOpen, onClear, dateControl }: QuickFilterBarProps) {
  const reduce = useReducedMotion() ?? false
  const active = selectedIds.length > 0
  const selectedCats = selectedIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => Boolean(c))
  // Keep the row a single fixed-height line: show a few category chips, then a "+N" overflow.
  const MAX_CHIPS = 4
  const shownCats = selectedCats.slice(0, MAX_CHIPS)
  const overflow = selectedCats.length - shownCats.length
  const swap = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: -8 },
    transition: TWEEN_FAST,
  }

  return (
    // relative + z-30: the optional dateControl opens a floating popover whose absolute child must
    // paint above the task grid that follows this plate in the DOM (a later non-positioned sibling).
    <div className={cn(PLATE_SURFACE, "relative z-30")}>
      <div className={cn(PLATE_ROW, "flex-col items-stretch gap-4 py-4 sm:flex-row sm:items-center sm:py-0")}>
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden="true" className={PLATE_ICON}>
            <SlidersHorizontal className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-body-sm font-bold tracking-tight text-ink">Quick filter</h2>
            {/* Fixed-height subtitle row — children are absolutely positioned so the crossfade
                between the idle hint and the active-filter summary never changes the plate height. */}
            <div className="relative mt-0.5 h-5">
              <AnimatePresence mode="wait" initial={false}>
                {active ? (
                  <motion.div key="active" {...swap} className="absolute inset-0 flex items-center gap-2">
                    <div className="flex items-center -space-x-1">
                      {shownCats.map((cat) => {
                        const CatIcon = cat.icon ? (ICON_MAP[cat.icon] ?? null) : null
                        return (
                          <motion.div
                            key={cat.id}
                            initial={reduce ? false : { scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={SPRING_RESPONSIVE}
                            className="flex h-4 w-4 items-center justify-center rounded-sm ring-1 ring-paper"
                            style={{ backgroundColor: `color-mix(in srgb, ${cat.color ?? "var(--pl-ink-subtle)"} 14%, transparent)` }}
                            title={cat.name}
                          >
                            {CatIcon ? (
                              <CatIcon className="h-2.5 w-2.5" style={{ color: cat.color ?? "var(--pl-ink-subtle)" }} aria-hidden="true" />
                            ) : (
                              <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cat.color ?? "var(--pl-ink-subtle)" }} />
                            )}
                          </motion.div>
                        )
                      })}
                    </div>
                    <span className="whitespace-nowrap text-caption font-semibold text-ink-muted">
                      {overflow > 0 && <span>+{overflow} · </span>}
                      {selectedCats.length === 1 ? "1 category" : `${selectedCats.length} categories`}
                    </span>
                    <button
                      type="button"
                      onClick={onClear}
                      aria-label="Clear category filter"
                      className="touch-target flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-fast hover:bg-paper-sunken hover:text-ink"
                    >
                      <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                    </button>
                  </motion.div>
                ) : (
                  <motion.p
                    key="idle"
                    {...swap}
                    className="absolute inset-0 flex items-center whitespace-nowrap text-caption font-medium text-ink-muted"
                  >
                    Filter tasks by category.
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {dateControl}
          <span className="hidden items-center gap-1.5 text-caption font-semibold text-ink-muted md:inline-flex">
            <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line bg-paper-sunken px-1.5 font-sans text-caption font-semibold text-ink-muted">
              F
            </kbd>
            to filter
          </span>
          <Button variant="outline" onClick={onOpen} className="flex-1 sm:flex-none" aria-keyshortcuts="f">
            Choose categories
          </Button>
        </div>
      </div>
    </div>
  )
}
