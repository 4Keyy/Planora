"use client"

import { motion, AnimatePresence } from "framer-motion"
import { SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ICON_MAP } from "@/lib/icon-map"
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
 * The "Quick Filter" plate shared by /tasks and /tasks/completed. The applied-filter summary
 * lives *inside* this same plate (not as a separate block) and swaps in via a crossfade in a
 * fixed-height subtitle row, so turning a filter on/off never grows or jolts the plate.
 */
export function QuickFilterBar({ categories, selectedIds, onOpen, onClear, dateControl }: QuickFilterBarProps) {
  const active = selectedIds.length > 0
  const selectedCats = selectedIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => Boolean(c))
  // Keep the row a single fixed-height line: show a few category chips, then a "+N" overflow.
  const MAX_CHIPS = 4
  const shownCats = selectedCats.slice(0, MAX_CHIPS)
  const overflow = selectedCats.length - shownCats.length

  return (
    <motion.div
      initial={{ y: -10, scale: 0.98, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      // relative + z-30: the optional dateControl opens a floating popover whose absolute child must
      // paint above the task grid that follows this plate in the DOM (a later non-positioned sibling).
      className="relative z-30 bg-paper/50 backdrop-blur-sm border border-line rounded-[2rem] p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm w-full"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="h-10 w-10 rounded-xl bg-ink text-paper flex items-center justify-center shadow-lg shadow-black/10 flex-shrink-0">
          <SlidersHorizontal className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-body-sm font-bold text-ink uppercase tracking-wider">Quick Filter</h2>
          {/* Fixed-height subtitle row — children are absolutely positioned so the crossfade
              between the idle hint and the active-filter summary never changes the plate height. */}
          <div className="relative h-5 mt-0.5">
            <AnimatePresence mode="wait" initial={false}>
              {active ? (
                <motion.div
                  key="active"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-0 flex items-center gap-2"
                >
                  <div className="flex items-center -space-x-1">
                    {shownCats.map((cat) => {
                      const CatIcon = cat.icon ? (ICON_MAP[cat.icon] ?? null) : null
                      return (
                        <motion.div
                          key={cat.id}
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 500, damping: 22 }}
                          className="h-4 w-4 rounded-md flex items-center justify-center ring-1 ring-white"
                          style={{ backgroundColor: `${cat.color ?? "#9ca3af"}22` }}
                          title={cat.name}
                        >
                          {CatIcon ? (
                            <CatIcon className="h-2.5 w-2.5" style={{ color: cat.color ?? "#9ca3af" }} />
                          ) : (
                            <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cat.color ?? "#9ca3af" }} />
                          )}
                        </motion.div>
                      )
                    })}
                  </div>
                  <span className="text-caption font-bold text-ink-muted whitespace-nowrap">
                    {overflow > 0 && <span className="text-ink-subtle">+{overflow} · </span>}
                    {selectedCats.length === 1 ? "1 category" : `${selectedCats.length} categories`}
                  </span>
                  <button
                    onClick={onClear}
                    aria-label="Clear category filter"
                    className="ml-0.5 h-4 w-4 rounded-md flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-gray-200/70 transition-colors flex-shrink-0"
                  >
                    <X className="h-3 w-3" strokeWidth={2.5} />
                  </button>
                </motion.div>
              ) : (
                <motion.p
                  key="idle"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-0 flex items-center text-caption text-ink-subtle font-medium whitespace-nowrap"
                >
                  Filter tasks by category.
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {dateControl}
        <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-gray-100/80 rounded-lg border border-line/50">
          <kbd className="font-mono bg-paper px-2 py-0.5 rounded text-caption font-bold border border-line shadow-sm text-ink-muted">F</kbd>
          <span className="text-caption font-bold text-ink-muted ml-1">to filter</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg font-bold text-caption h-10 border-line hover:bg-ink hover:text-paper hover:border-black transition-[background-color,border-color,color] px-6"
          onClick={onOpen}
        >
          Open menu
        </Button>
      </div>
    </motion.div>
  )
}
