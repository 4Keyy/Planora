"use client"

import { useEffect, useId, useRef, useState } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { CalendarSearch, ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { DateCalendar } from "./edit-todo-modal/popovers/date"
import { formatDueRange } from "./edit-todo-modal/utils"

interface DateFilterPopoverProps {
  /** START of the completion window (YYYY-MM-DD or ""). Empty for a single-day filter. */
  start: string
  /** END / single day of the completion window (YYYY-MM-DD or ""). */
  end: string
  /** Commit a new window. Mirrors DateCalendar's contract. */
  onChange: (start: string | null, end: string | null) => void
  /** Wipe the window entirely. */
  onClear: () => void
}

/**
 * Completion-date filter rendered as a compact trigger that lives *inside* the QuickFilter plate
 * and opens its calendar as a floating popover.
 *
 * Why a popover and not an inline collapse: the calendar must never push the page down or grow the
 * filter plate. The trigger is the same height as the plate's other controls, and the calendar is
 * absolutely positioned (z-50) so it overlays the task grid below instead of reflowing it. It scales
 * out of its top-right corner (origin-aware), closes on outside-click / Escape, and honours
 * prefers-reduced-motion.
 */
export function DateFilterPopover({ start, end, onChange, onClear }: DateFilterPopoverProps) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const hasFilter = !!(start || end)

  // Dismiss on outside pointer-down and Escape. Capture phase so a click that also lands on another
  // interactive element still closes the popover first. Only wired while open to stay cheap.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown, true)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      {/* Trigger — styled to match the plate's "F to filter" pill so the calendar reads as native to
          the filter bar. Fixed h-10 keeps the plate exactly the same height as before. */}
      <div
        className={cn(
          "flex h-10 items-center gap-0.5 rounded-lg border bg-gray-100/80 pl-1 pr-1 transition-colors",
          open ? "border-line-strong bg-paper" : "border-line/60",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={panelId}
          className="touch-target flex h-8 max-w-[220px] items-center gap-2 rounded-md px-2.5 text-caption font-bold text-ink-muted transition-colors hover:bg-paper hover:text-ink cursor-pointer"
        >
          <CalendarSearch className="h-4 w-4 flex-shrink-0 text-ink-subtle" strokeWidth={1.8} aria-hidden="true" />
          <span className={cn("truncate", hasFilter ? "text-ink" : "text-ink-muted")}>
            {hasFilter ? formatDueRange(start, end) : "By date"}
          </span>
          <ChevronDown
            className={cn("ml-auto h-3.5 w-3.5 flex-shrink-0 text-ink-subtle transition-transform duration-base", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        <AnimatePresence initial={false}>
          {hasFilter && (
            <motion.button
              type="button"
              onClick={onClear}
              aria-label="Clear completion-date filter"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-paper hover:text-ink cursor-pointer"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Floating calendar — overlays the grid below; never affects page height. */}
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label="Filter completed tasks by completion date"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-50 mt-2 w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-paper shadow-xl shadow-black/10"
          >
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
              <span className="text-caption font-bold uppercase tracking-wider text-ink-subtle">Completed on</span>
              {hasFilter && (
                <button
                  type="button"
                  onClick={onClear}
                  className="text-caption font-bold uppercase tracking-wider text-ink-subtle transition-colors hover:text-ink rounded cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
            <DateCalendar
              start={start}
              end={end}
              onChange={onChange}
              autoClose={() => setOpen(false)}
              headless
              hideQuickPicks
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
