"use client"

import { RefObject, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Popover, PopoverHeader } from "../popover"
import { RU_MONTHS_LONG, RU_DAYS_SHORT } from "../utils"

interface DatePopoverProps {
  open: boolean
  onClose: () => void
  value: string          // YYYY-MM-DD or ""
  onChange: (isoDate: string | null) => void
  containerRef: RefObject<HTMLElement | null>
  /** When true the date options are shown muted and non-interactive (non-owner viewer). */
  readOnly?: boolean
}

function toISO(d: Date): string {
  return d.toISOString().split("T")[0]
}

function addDays(base: string | null, n: number): string {
  const d = base ? new Date(base) : new Date()
  d.setDate(d.getDate() + n)
  return toISO(d)
}

function todayISO(): string { return toISO(new Date()) }

export function DatePopover({ open, onClose, value, onChange, containerRef, readOnly }: DatePopoverProps) {
  return (
    <Popover open={open} onClose={onClose} width={320} containerRef={containerRef}>
      <DateCalendar value={value} onChange={onChange} readOnly={readOnly} autoClose={onClose} />
    </Popover>
  )
}

interface DateCalendarProps {
  value: string                 // YYYY-MM-DD or ""
  onChange: (isoDate: string | null) => void
  readOnly?: boolean
  /** Called after a pick — the popover closes; the always-open sidebar omits it (stays open). */
  autoClose?: () => void
  /** Drops the popover's header/CLEAR row; the sidebar renders its own header + clear control. */
  headless?: boolean
}

/**
 * The due-date quick-picks + month calendar, extracted from {@link DatePopover} so it can render
 * inline (always-open) in the branch page's meta sidebar as well as inside the popover.
 */
export function DateCalendar({ value, onChange, readOnly, autoClose, headless }: DateCalendarProps) {
  const nowDate   = new Date()
  const initYear  = value ? new Date(value).getFullYear() : nowDate.getFullYear()
  const initMonth = value ? new Date(value).getMonth()    : nowDate.getMonth()

  const [viewYear,  setViewYear]  = useState(initYear)
  const [viewMonth, setViewMonth] = useState(initMonth)

  const today     = todayISO()
  const tomorrow  = addDays(today, 1)
  const plus3     = addDays(today, 3)
  const plusWeek  = addDays(today, 7)

  const quickPicks = [
    { label: "Today",      iso: today     },
    { label: "Tomorrow",   iso: tomorrow  },
    { label: "+ 3 days",   iso: plus3     },
    { label: "Next week",  iso: plusWeek  },
  ]

  const selectDate = (iso: string) => { if (readOnly) return; onChange(iso); autoClose?.() }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11) }
    else setViewMonth(viewMonth - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0) }
    else setViewMonth(viewMonth + 1)
  }

  // Build calendar days (Mon-first)
  const firstDay   = new Date(viewYear, viewMonth, 1)
  const lastDay    = new Date(viewYear, viewMonth + 1, 0)
  const startOffset = (firstDay.getDay() + 6) % 7  // Mon=0
  const daysInMonth = lastDay.getDate()
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to multiple of 7
  while (cells.length % 7 !== 0) cells.push(null)

  const clearAction = value && !readOnly ? (
    <button
      onClick={() => { onChange(null); autoClose?.() }}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "#525252",
        padding: 0,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#0a0a0a" }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#525252" }}
    >
      CLEAR
    </button>
  ) : undefined

  return (
    <>
      {/* Header with "Очистить" on same row (omitted in the headless/sidebar variant) */}
      {!headless && <PopoverHeader label="Due date" action={clearAction} />}

      {/* Quick picks — owner only. A non-owner viewer reads the date but never sets it, so the
          Today/Tomorrow/… shortcuts are omitted entirely (not just disabled). */}
      {!readOnly && (
        <div style={{
          padding: "10px 12px",
          borderBottom: "1px solid #f5f5f5",
          display: "flex",
          gap: 4,
          flexWrap: "wrap",
        }}>
          {quickPicks.map((q) => {
            const isActive = value === q.iso
            return (
              <button
                key={q.label}
                onClick={() => selectDate(q.iso)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 100,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "-0.01em",
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
        <div style={{
          background: "white",
          border: "1px solid #f0f0f0",
          borderRadius: 12,
          padding: 12,
        }}>
          {/* Nav row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button
              onClick={prevMonth}
              style={{
                width: 26, height: 26,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "#fafafa", border: "none", borderRadius: 8, cursor: "pointer",
              }}
            >
              <ChevronLeft size={13} color="#525252" />
            </button>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#0a0a0a" }}>
              {RU_MONTHS_LONG[viewMonth]} {viewYear}
            </span>
            <button
              onClick={nextMonth}
              style={{
                width: 26, height: 26,
                display: "flex", alignItems: "center", justifyContent: "center",
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
                textAlign: "center",
                fontSize: 9,
                fontWeight: 900,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#d4d4d4",
                padding: "2px 0",
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {cells.map((day, idx) => {
              if (!day) return <div key={`e-${idx}`} />
              const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
              const isSelected = value === iso
              const isToday    = today === iso
              return (
                <button
                  key={iso}
                  onClick={() => selectDate(iso)}
                  style={{
                    height: 30,
                    borderRadius: 7,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: isToday || isSelected ? 800 : 500,
                    background: isSelected ? "#0a0a0a" : isToday ? "#f5f5f5" : "transparent",
                    color: isSelected ? "white" : "#262626",
                    transition: "background 100ms",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "#f0f0f0" }}
                  onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = isToday ? "#f5f5f5" : "transparent" }}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
