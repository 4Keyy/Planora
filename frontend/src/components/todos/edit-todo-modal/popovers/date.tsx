"use client"

import { RefObject, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { Popover, PopoverHeader } from "../popover"
import { RU_MONTHS_LONG, RU_DAYS_SHORT, computeNextDueRange, type DueRange } from "../utils"

interface DatePopoverProps {
  open: boolean
  onClose: () => void
  /** START of the estimated-completion interval (YYYY-MM-DD or ""). Empty for a single date. */
  start: string
  /** END / single target date (YYYY-MM-DD or ""). The deadline bound. */
  end: string
  onChange: (start: string | null, end: string | null) => void
  containerRef: RefObject<HTMLElement | null>
  /** When true the date options are shown muted and non-interactive (non-owner viewer). */
  readOnly?: boolean
  /** Render in a viewport-fixed body portal (create panel / dashboard) so it can't stretch the page. */
  portal?: boolean
}

function pad(n: number): string { return String(n).padStart(2, "0") }
function toISO(d: Date): string { return d.toISOString().split("T")[0] }

function addDays(base: string | null, n: number): string {
  const d = base ? new Date(base) : new Date()
  d.setDate(d.getDate() + n)
  return toISO(d)
}

function todayISO(): string { return toISO(new Date()) }

export function DatePopover({ open, onClose, start, end, onChange, containerRef, readOnly, portal }: DatePopoverProps) {
  return (
    <Popover open={open} onClose={onClose} width={332} containerRef={containerRef} portal={portal}>
      <DateCalendar start={start} end={end} onChange={onChange} readOnly={readOnly} autoClose={onClose} />
    </Popover>
  )
}

interface DateCalendarProps {
  /** START of the interval (YYYY-MM-DD or ""). Empty for a single-date or no-date task. */
  start: string
  /** END / single target date (YYYY-MM-DD or ""). */
  end: string
  onChange: (start: string | null, end: string | null) => void
  readOnly?: boolean
  /** Called after the selection completes (a clear, or the second pick of an interval) so the
   *  popover can close. The always-open sidebar omits it. A single first pick keeps it open so the
   *  user can immediately extend it into an interval without re-opening. */
  autoClose?: () => void
  /** Drops the popover's header/CLEAR row; the sidebar renders its own header + clear control. */
  headless?: boolean
  /** Hides the Today/Tomorrow/… quick-pick chips (the always-open sidebar shows the calendar only). */
  hideQuickPicks?: boolean
}

/**
 * Estimated-completion calendar — supports both a single target date and a planned interval.
 *
 * Interaction (two-click range; see {@link computeNextDueRange}): the first click sets a single
 * target date. Clicking it again clears it. Clicking a different day turns the selection into a
 * sorted interval — the later day is always the deadline. Once a full interval exists, the next
 * click starts over with a fresh single date. While a single date is set, hovering another day
 * previews the interval it would create (a soft ghost band) so the result is obvious before commit.
 */
export function DateCalendar({ start, end, onChange, readOnly, autoClose, headless, hideQuickPicks }: DateCalendarProps) {
  const reduce = useReducedMotion()
  const anchor    = end || start
  const nowDate   = new Date()
  const initYear  = anchor ? new Date(anchor).getFullYear() : nowDate.getFullYear()
  const initMonth = anchor ? new Date(anchor).getMonth()    : nowDate.getMonth()

  const [viewYear,  setViewYear]  = useState(initYear)
  const [viewMonth, setViewMonth] = useState(initMonth)
  // Direction of the last month navigation (1 = forward, -1 = back) so the grid slides the right way.
  const [navDir,    setNavDir]    = useState(0)
  // Day currently hovered — drives the live interval preview while a single date is set.
  const [hoverDay,  setHoverDay]  = useState<string | null>(null)

  const today     = todayISO()
  const startN: string | null = start || null
  const endN: string | null   = end || null
  const hasRange  = !!startN && !!endN && startN !== endN

  const quickPicks = [
    { label: "Today",      iso: today              },
    { label: "Tomorrow",   iso: addDays(today, 1)  },
    { label: "+ 3 days",   iso: addDays(today, 3)  },
    { label: "Next week",  iso: addDays(today, 7)  },
  ]

  const commit = (next: DueRange) => {
    onChange(next.start, next.end)
    // Close once the selection reaches a terminal state: a cleared date, or a completed interval.
    // A first single pick stays open so it can be extended into an interval in the same session.
    const completedInterval = !!next.start && !!next.end
    const cleared = !next.start && !next.end
    if (completedInterval || cleared) autoClose?.()
  }

  const pickDay = (iso: string) => {
    if (readOnly) return
    commit(computeNextDueRange({ start: startN, end: endN }, iso))
  }

  const pickQuick = (iso: string) => {
    if (readOnly) return
    // Quick-picks always set a single target date (clearing any interval), then close.
    onChange(null, iso)
    autoClose?.()
  }

  const goMonth = (dir: -1 | 1) => {
    setNavDir(dir)
    setViewMonth((m) => {
      const next = m + dir
      if (next < 0)  { setViewYear((y) => y - 1); return 11 }
      if (next > 11) { setViewYear((y) => y + 1); return 0 }
      return next
    })
  }

  // Build calendar days (Mon-first)
  const firstDay    = new Date(viewYear, viewMonth, 1)
  const lastDay     = new Date(viewYear, viewMonth + 1, 0)
  const startOffset = (firstDay.getDay() + 6) % 7  // Mon=0
  const daysInMonth = lastDay.getDate()
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  // The live preview interval: only while a single date is set and another day is hovered.
  const previewing = !!endN && !startN && !!hoverDay && hoverDay !== endN && !readOnly
  const pLow  = previewing ? (hoverDay! < endN! ? hoverDay! : endN!) : null
  const pHigh = previewing ? (hoverDay! < endN! ? endN! : hoverDay!) : null

  const clearAction = (startN || endN) && !readOnly ? (
    <button
      onClick={() => commit({ start: null, end: null })}
      style={{
        background: "none", border: "none", cursor: "pointer",
        fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
        textTransform: "uppercase", color: "#525252", padding: 0,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#0a0a0a" }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#525252" }}
    >
      CLEAR
    </button>
  ) : undefined

  return (
    <>
      {/* Header with CLEAR on the same row (omitted in the headless/sidebar variant) */}
      {!headless && <PopoverHeader label="Due date" action={clearAction} />}

      {/* Quick picks — owner only, suppressed entirely in the always-open sidebar. */}
      {!readOnly && !hideQuickPicks && (
        <div style={{
          padding: "10px 12px", borderBottom: "1px solid #f5f5f5",
          display: "flex", gap: 4, flexWrap: "wrap",
        }}>
          {quickPicks.map((q) => {
            const isActive = !startN && endN === q.iso
            return (
              <button
                key={q.label}
                onClick={() => pickQuick(q.iso)}
                style={{
                  padding: "6px 10px", borderRadius: 100, border: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 800, letterSpacing: "-0.01em",
                  background: isActive ? "#0a0a0a" : "#fafafa",
                  color: isActive ? "white" : "#0a0a0a",
                  transition: "background 120ms, color 120ms",
                }}
              >
                {q.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Calendar */}
      <div style={{ padding: 10, opacity: readOnly ? 0.55 : 1, pointerEvents: readOnly ? "none" : "auto" }}>
        <div style={{ background: "white", border: "1px solid #f0f0f0", borderRadius: 12, padding: 12 }}>
          {/* Nav row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button
              onClick={() => goMonth(-1)}
              aria-label="Previous month"
              style={{
                width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
                background: "#fafafa", border: "none", borderRadius: 8, cursor: "pointer",
              }}
            >
              <ChevronLeft size={13} color="#525252" />
            </button>
            <div style={{ position: "relative", overflow: "hidden", height: 18, flex: 1, textAlign: "center" }}>
              <AnimatePresence initial={false} mode="popLayout" custom={navDir}>
                <motion.span
                  key={`${viewYear}-${viewMonth}`}
                  custom={navDir}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: navDir * 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: navDir * -14 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 800, color: "#0a0a0a",
                  }}
                >
                  {RU_MONTHS_LONG[viewMonth]} {viewYear}
                </motion.span>
              </AnimatePresence>
            </div>
            <button
              onClick={() => goMonth(1)}
              aria-label="Next month"
              style={{
                width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
                background: "#fafafa", border: "none", borderRadius: 8, cursor: "pointer",
              }}
            >
              <ChevronRight size={13} color="#525252" />
            </button>
          </div>

          {/* Week header */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {RU_DAYS_SHORT.map((d) => (
              <div key={d} style={{
                textAlign: "center", fontSize: 9, fontWeight: 900, letterSpacing: "0.14em",
                textTransform: "uppercase", color: "#d4d4d4", padding: "2px 0",
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid — keyed on the month so it cross-fades/slides on navigation. */}
          <AnimatePresence initial={false} mode="popLayout" custom={navDir}>
            <motion.div
              key={`${viewYear}-${viewMonth}`}
              custom={navDir}
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: navDir * 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: navDir * -18 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              onMouseLeave={() => setHoverDay(null)}
              style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}
            >
              {cells.map((day, idx) => {
                if (!day) return <div key={`e-${idx}`} />
                const iso     = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`
                const isToday = today === iso

                // Caps: the solid black chips at the bounds.
                const isStartCap = hasRange && iso === startN
                const isEndCap   = !!endN && iso === endN          // also the single-date cap
                const isCap      = isStartCap || isEndCap

                // Committed interval band membership (strictly between, plus the caps span it).
                const inSolid = hasRange && iso >= startN! && iso <= endN!

                // Preview band membership + the ghost cap on the hovered day.
                const inPreview      = previewing && iso >= pLow! && iso <= pHigh!
                const isPreviewCap   = previewing && iso === hoverDay

                // Which band (if any) this cell belongs to, and its low/high for rounding.
                const bandLow  = inSolid ? startN! : inPreview ? pLow! : null
                const bandHigh = inSolid ? endN!   : inPreview ? pHigh! : null
                const inBand   = inSolid || inPreview
                const col      = idx % 7
                const roundLeft  = !inBand || iso === bandLow  || col === 0
                const roundRight = !inBand || iso === bandHigh || col === 6

                return (
                  <button
                    key={iso}
                    onClick={() => pickDay(iso)}
                    onMouseEnter={() => setHoverDay(iso)}
                    aria-label={iso}
                    aria-pressed={isCap || undefined}
                    style={{
                      position: "relative", height: 32, border: "none", background: "transparent",
                      cursor: "pointer", padding: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {/* Interval band layer — bridges the 2px grid gap so it reads as continuous. */}
                    {inBand && (
                      <motion.span
                        aria-hidden
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        style={{
                          position: "absolute", top: 3, bottom: 3,
                          left:  roundLeft  ? 2 : -2,
                          right: roundRight ? 2 : -2,
                          borderTopLeftRadius:    roundLeft  ? 8 : 0,
                          borderBottomLeftRadius: roundLeft  ? 8 : 0,
                          borderTopRightRadius:    roundRight ? 8 : 0,
                          borderBottomRightRadius: roundRight ? 8 : 0,
                          background: inSolid ? "#f1f1f4" : "rgba(82,82,82,0.10)",
                          border: inPreview && !inSolid ? "1px dashed rgba(82,82,82,0.40)" : "none",
                          borderLeft:  inPreview && !inSolid && !roundLeft  ? "none" : undefined,
                          borderRight: inPreview && !inSolid && !roundRight ? "none" : undefined,
                        }}
                      />
                    )}

                    {/* Today marker (only when this day carries no cap). */}
                    {isToday && !isCap && (
                      <span aria-hidden style={{
                        position: "absolute", inset: 3, borderRadius: 8,
                        background: inBand ? "transparent" : "#f5f5f5",
                      }} />
                    )}

                    {/* Solid bound cap (start / end / single date). */}
                    {isCap && (
                      <motion.span
                        aria-hidden
                        layout
                        initial={reduce ? false : { scale: 0.7, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 520, damping: 30 }}
                        style={{
                          position: "absolute", inset: 2, borderRadius: 8, background: "#0a0a0a",
                          boxShadow: "0 2px 6px rgba(10,10,10,0.22)",
                        }}
                      />
                    )}

                    {/* Ghost cap on the hovered day while previewing an interval. */}
                    {isPreviewCap && !isCap && (
                      <span aria-hidden style={{
                        position: "absolute", inset: 2, borderRadius: 8,
                        border: "1.5px solid rgba(82,82,82,0.55)",
                        background: "rgba(82,82,82,0.06)",
                      }} />
                    )}

                    <span style={{
                      position: "relative", zIndex: 1,
                      fontSize: 12,
                      fontWeight: isCap || isToday ? 800 : 500,
                      color: isCap ? "white" : (inSolid || isPreviewCap) ? "#404040" : "#262626",
                      transition: "color 120ms",
                    }}>
                      {day}
                    </span>
                  </button>
                )
              })}
            </motion.div>
          </AnimatePresence>

          {/* Hint line — explains the second click turns the date into an interval. */}
          {!readOnly && (
            <div style={{
              marginTop: 8, paddingTop: 8, borderTop: "1px solid #f5f5f5",
              fontSize: 10, fontWeight: 600, letterSpacing: "0.01em", color: "#a3a3a3", textAlign: "center",
            }}>
              {hasRange
                ? "Click any day to start a new date"
                : endN
                  ? "Click another day to set an interval"
                  : "Pick a target date — click twice for an interval"}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
