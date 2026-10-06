"use client"

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Plus } from "lucide-react"
import { SHARING_CEILING, viewerValueText } from "@/lib/landing-audience"
import { SPRING_GENTLE, SPRING_STANDARD, TWEEN_FAST } from "@/lib/animations"
import { cn } from "@/lib/utils"
import type { LandingFriend } from "./fixtures"

/** You, then ten seats. */
const MAX = 10
const STOPS = MAX + 1
const PAGE = 3
/** How far a finger must move sideways before a touch on the rail counts as a drag. */
const TOUCH_SLOP = 8

/** Where a column's centre sits, as a CSS length across the rail. */
const centre = (i: number) => `calc(${(i + 0.5) * (100 / STOPS)}%)`

function initials(name: string) {
  const [first = "", last = ""] = name.split(" ")
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase()
}

/**
 * The block-2 control: a row of seats you slide a ring along.
 *
 * It replaced a browser range input flanked by a minus and a plus — three controls for one
 * number, drawn by the browser rather than by the product. Here the number IS the picture:
 * the first seat is you, the next ten are the people you could let in, and a ring rides to
 * the last person inside. Everyone up to the ring is a face; everyone after it is an empty
 * seat. Past the eighth seat the rail turns dashed, because that is where the audience mark
 * stops widening.
 *
 * One control, three ways in:
 *
 * - **Drag or press anywhere on the rail.** The value is the column under the pointer, so a
 *   press on a seat takes the ring straight there and a drag sweeps it seat by seat.
 *   `touch-action: pan-y` keeps a vertical swipe scrolling the page on a phone while a
 *   sideways one moves the ring.
 * - **The keyboard.** It is a real `role="slider"`: arrows step one person, Page Up and
 *   Page Down three, Home and End go to "only you" and ten. `aria-valuetext` says people,
 *   not a bare number.
 * - **Hover** previews the seat a press would pick, so the rail answers before it is used.
 *
 * Motion is transform and opacity only. The ring is one column wide and moves by `x` in
 * percent of its OWN width, so `x: 300%` is exactly three seats at any rail width, with no
 * measuring and nothing different between the server render and the first client one. The
 * inked part of the rail is a full-length line scaled from its left end.
 */
export function SeatRail({
  value,
  onChange,
  friends,
  labelledBy,
}: {
  value: number
  onChange: (value: number) => void
  friends: readonly LandingFriend[]
  labelledBy: string
}) {
  const reduce = useReducedMotion() ?? false
  const railRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  const columnAt = (clientX: number) => {
    const el = railRef.current
    if (!el) return value
    const { left, width } = el.getBoundingClientRect()
    if (!(width > 0)) return value
    return Math.max(0, Math.min(MAX, Math.floor(((clientX - left) / width) * STOPS)))
  }

  const pick = (n: number) => {
    const next = Math.max(0, Math.min(MAX, n))
    if (next !== value) onChange(next)
  }

  /*
   * A mouse or pen picks at once. A finger does not: the rail is full-width and 64px tall, so
   * a thumb that lands on it while scrolling the page must not move the ring. Touch waits for
   * intent — a sideways drag past a few pixels starts a drag, a lift without one is a tap, and
   * a vertical swipe is handed to the browser (`touch-action: pan-y`), which cancels ours.
   */
  const gesture = useRef<{ id: number; x: number; y: number; touch: boolean; active: boolean } | null>(null)

  const beginDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setHover(null)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const touch = e.pointerType === "touch"
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, touch, active: !touch }
    if (touch) return
    beginDrag(e)
    pick(columnAt(e.clientX))
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (g && g.id === e.pointerId) {
      if (!g.active) {
        const dx = e.clientX - g.x
        const dy = e.clientY - g.y
        if (Math.abs(dx) < TOUCH_SLOP || Math.abs(dx) <= Math.abs(dy)) return
        g.active = true
        beginDrag(e)
      }
      pick(columnAt(e.clientX))
    } else if (e.pointerType === "mouse") {
      setHover(columnAt(e.clientX))
    }
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    // A finger that lifted without dragging was a tap on a seat.
    if (g && g.id === e.pointerId && g.touch && !g.active) pick(columnAt(e.clientX))
    onPointerEnd(e)
  }

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    gesture.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = {
      ArrowRight: value + 1,
      ArrowUp: value + 1,
      ArrowLeft: value - 1,
      ArrowDown: value - 1,
      PageUp: value + PAGE,
      PageDown: value - PAGE,
      Home: 0,
      End: MAX,
    }
    if (!(e.key in step)) return
    e.preventDefault()
    pick(step[e.key])
  }

  const move = reduce ? { duration: 0 } : SPRING_STANDARD

  return (
    <div>
      <div
        ref={railRef}
        role="slider"
        tabIndex={0}
        aria-labelledby={labelledBy}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={MAX}
        aria-valuenow={value}
        aria-valuetext={viewerValueText(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerEnd}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        className={cn(
          "relative h-16 select-none rounded-full border border-line bg-paper-sunken outline-offset-4",
          "touch-pan-y transition-colors duration-fast hover:border-line-strong",
          dragging ? "cursor-grabbing" : "cursor-pointer"
        )}
      >
        {/* The rail: solid to the ceiling, dashed past it, and inked up to the ring. */}
        <span
          aria-hidden="true"
          className="absolute top-[calc(50%-1px)] h-0.5 rounded-full bg-line-strong"
          style={{ left: centre(0), right: `calc(100% - ${centre(SHARING_CEILING)})` }}
        />
        <span
          aria-hidden="true"
          className="absolute top-[calc(50%-1px)] h-0.5 border-t-2 border-dashed border-line-strong"
          style={{ left: centre(SHARING_CEILING), right: `calc(100% - ${centre(MAX)})` }}
        />
        <motion.span
          aria-hidden="true"
          className="absolute top-[calc(50%-1px)] h-0.5 origin-left rounded-full bg-ink"
          style={{ left: centre(0), right: `calc(100% - ${centre(MAX)})` }}
          initial={false}
          animate={{ scaleX: value / MAX }}
          transition={move}
        />

        {/* The seats. */}
        <div aria-hidden="true" className="absolute inset-0 flex">
          {Array.from({ length: STOPS }, (_, i) => {
            const inside = i <= value
            const friend = friends[i - 1]
            return (
              <span key={i} className="relative grid flex-1 place-items-center">
                {i === 0 ? (
                  // You: the private mark's filled centre, the one seat that is always taken.
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-ink sm:h-8 sm:w-8">
                    <span className="h-1.5 w-1.5 rounded-full bg-paper sm:h-2 sm:w-2" />
                  </span>
                ) : (
                  <span className="relative grid h-5 w-5 place-items-center sm:h-8 sm:w-8">
                    <span
                      className={cn(
                        "absolute inset-0 grid place-items-center rounded-full border-2 border-dashed bg-paper-sunken transition-colors duration-fast",
                        hover === i && !inside ? "border-ink text-ink" : "border-line-strong text-ink-subtle"
                      )}
                    >
                      <Plus className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5" />
                    </span>
                    <AnimatePresence initial={false}>
                      {inside && friend && (
                        <motion.span
                          key="face"
                          className="absolute inset-0 grid place-items-center rounded-full bg-ink text-caption font-bold text-paper"
                          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                          transition={reduce ? TWEEN_FAST : SPRING_GENTLE}
                        >
                          {/* Initials only from `sm`: at 20px two letters crowd the disc. */}
                          <span className="hidden sm:inline">{initials(friend.name)}</span>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                )}
              </span>
            )
          })}
        </div>

        {/* The ring you slide: one column wide, moved by whole columns. A static wrapper
            centres it on the column — on a phone it is wider than its column, and a grid
            cell would have started it at the column's left edge — and the node inside it
            does the scaling, so the centring transform is never overwritten. */}
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{ width: `${100 / STOPS}%` }}
          initial={false}
          animate={{ x: `${value * 100}%` }}
          transition={move}
        >
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <motion.span
              className="block h-8 w-8 rounded-full border-2 border-ink bg-transparent shadow-md sm:h-11 sm:w-11"
              animate={{ scale: dragging && !reduce ? 1.12 : 1 }}
              transition={reduce ? { duration: 0 } : SPRING_GENTLE}
            />
          </span>
        </motion.span>
      </div>

      {/* The three readings that matter, each under its own seat. */}
      <div aria-hidden="true" className="relative mt-2 h-4 text-caption font-semibold tabular-nums text-ink-muted">
        <span className="absolute -translate-x-1/2" style={{ left: centre(0) }}>
          You
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: centre(SHARING_CEILING) }}>
          8
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: centre(MAX) }}>
          10
        </span>
      </div>
    </div>
  )
}
