"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Check, Plus } from "lucide-react"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import { Avatar } from "@/components/ui/avatar"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { deriveAudience } from "@/lib/landing-audience"
import {
  CIRCLE_SEATS,
  CIRCLE_TASK_TITLE,
  circleSentence,
  SURPRISE_FOR,
  type SeatId,
} from "@/lib/landing-circle"
import {
  DURATION_FAST,
  DURATION_UI,
  EASE_EXIT,
  EASE_OUT_EXPO,
  SPRING_GENTLE,
  TAP_PRESS,
} from "@/lib/animations"
import { cn } from "@/lib/utils"
import { AudienceRing } from "./audience-ring"

/**
 * Block 1 — who's in on this task.
 *
 * One concrete task where who sees it obviously matters: a surprise party for Mira. You
 * share it with Dana and Tom. Adding Mira is allowed, and the card says what that does to
 * the surprise — which is the product's whole idea (a task carries its audience) learned in
 * one tap, with a smile rather than a paragraph.
 *
 * Everything that moves is the product's own vocabulary: the ring is `AudienceRing`, drawn
 * by the same `redactionArc` the 14px badge on every task uses, and the badge in the task
 * row is the shipped `RedactionBadge` itself. A person joining arrives the way presence
 * arrives in the app (`SPRING_GENTLE`), and the line to them is drawn — the one motion that
 * says "you did this".
 *
 * Decisions that are not stylistic:
 *
 * - **The seats are fixed, and empty seats hold no text.** A seat for someone not yet in
 *   the circle is a dashed outline with a plus, never a dimmed avatar: dimmed initials are
 *   text below the contrast floor, whatever `aria-hidden` says.
 * - **The sentence is the block's one live region**, reserved at two lines, so the card's
 *   height is decided by the viewport and never by who is selected.
 * - **The stage is `aria-hidden`.** It restates the sentence as a picture; a screen reader
 *   gets the sentence once and the toggles with their pressed state.
 * - **The hint is bounded.** If nobody has pressed anything after a moment, the first chip
 *   nudges twice and stops for good. Nothing on this card moves at rest after that.
 */

/** Seat centres on the stage, in percent of its width and height. */
const SEAT_POS: Record<SeatId, { x: number; y: number }> = {
  dana: { x: 16, y: 30 },
  tom: { x: 84, y: 30 },
  mira: { x: 50, y: 80 },
}
const RING = { x: 50, y: 38, size: 112 }
const STAGE_HEIGHT = 256

export function AudienceConsole() {
  const reduce = useReducedMotion() ?? false
  const [selected, setSelected] = useState<SeatId[]>([])
  const [touched, setTouched] = useState(false)
  const [hint, setHint] = useState(false)
  const [wobble, setWobble] = useState(0)

  const count = selected.length
  const audience = deriveAudience(count)
  const sentence = circleSentence(selected)

  // The bounded hint: once, after a pause, only if nothing has been pressed.
  useEffect(() => {
    if (touched || reduce) return
    const t = setTimeout(() => setHint(true), 1600)
    return () => clearTimeout(t)
  }, [touched, reduce])

  const toggle = (id: SeatId) => {
    setTouched(true)
    setHint(false)
    const on = selected.includes(id)
    // Outside the updater: updaters must be pure, and StrictMode runs them twice.
    if (!on && id === SURPRISE_FOR) setWobble((w) => w + 1)
    setSelected(on ? selected.filter((x) => x !== id) : [...selected, id])
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-5 shadow-xl sm:p-7">
      {/* The task, as a row in the app would show it. The badge is the shipped one; its
          slot is a fixed width so "Private" ↔ "Shared 3" never reflows the title. */}
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-6 w-6 flex-shrink-0 rounded-full border-2 border-line-strong" />
        <p className="min-w-0 flex-1 truncate text-body font-semibold text-ink">{CIRCLE_TASK_TITLE}</p>
        <span className="flex w-24 flex-shrink-0 justify-end">
          <RedactionBadge audience={audience} viewerCount={count} size="sm" />
        </span>
      </div>

      <Stage selected={selected} wobble={wobble} reduce={reduce} />

      <p
        aria-live="polite"
        className="relative mt-5 min-h-14 text-title-sm font-bold tracking-tight text-ink"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={sentence}
            className="block"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } }}
            exit={
              reduce
                ? { opacity: 0, transition: { duration: DURATION_FAST } }
                : { opacity: 0, y: -8, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }
            }
          >
            {sentence}
          </motion.span>
        </AnimatePresence>
      </p>

      <p id="hero-share-with" className={cn(FIELD_LABEL_CLASS, "mt-4")}>
        Share with
      </p>
      <div role="group" aria-labelledby="hero-share-with" className="mt-3 flex flex-wrap gap-2">
        {CIRCLE_SEATS.map((seat, i) => {
          const on = selected.includes(seat.id)
          return (
            <motion.button
              key={seat.id}
              type="button"
              onClick={() => toggle(seat.id)}
              aria-pressed={on}
              whileTap={reduce ? undefined : TAP_PRESS}
              animate={hint && i === 0 ? { y: [0, -3, 0, -3, 0] } : { y: 0 }}
              transition={hint && i === 0 ? { duration: 1.1, ease: "easeInOut" } : { duration: DURATION_FAST }}
              onAnimationComplete={() => {
                if (hint && i === 0) setHint(false)
              }}
              className={cn(
                "relative inline-flex min-h-control items-center gap-2 rounded-full border py-1 pl-1.5 pr-4",
                "text-body-sm font-semibold transition-colors duration-fast",
                on
                  ? "border-ink bg-ink text-paper"
                  : "border-line-strong bg-paper text-ink hover:bg-paper-sunken"
              )}
            >
              {hint && i === 0 && (
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-full border-2 border-ink"
                  initial={{ scale: 1, opacity: 0.35 }}
                  animate={{ scale: 1.25, opacity: 0 }}
                  transition={{ duration: 0.55, ease: EASE_OUT_EXPO, repeat: 1 }}
                />
              )}
              {/* aria-hidden: the initials would otherwise open the accessible name — "DW Share
                  with Dana". */}
              <span aria-hidden="true" className="inline-flex">
                <Avatar firstName={seat.firstName} lastName={seat.lastName} size={32} />
              </span>
              <span className="sr-only">Share with </span>
              {seat.firstName}
              <span aria-hidden="true" className="grid h-4 w-4 place-items-center">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={on ? "on" : "off"}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: reduce ? 1 : 0.6 }}
                    transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
                    className="grid place-items-center"
                  >
                    {on ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </motion.span>
                </AnimatePresence>
              </span>
            </motion.button>
          )
        })}
      </div>

      <p className="mt-5 text-caption text-ink-muted">
        Made-up people. Nothing you tap here is sent anywhere.
      </p>
    </div>
  )
}

/**
 * The picture of the sentence: you in the ring, three seats around it, a line to each
 * person you let in.
 *
 * Lines are laid out in pixels from the stage's measured width, so they meet the ring's
 * edge and the seat's edge exactly at every viewport. Before the first measurement there
 * are no lines, which is also the correct picture of a private task.
 */
function Stage({ selected, wobble, reduce }: { selected: SeatId[]; wobble: number; reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cx = (RING.x / 100) * width
  const cy = (RING.y / 100) * STAGE_HEIGHT
  const ringR = RING.size / 2 + 4
  const seatR = 24 + 4

  const audience = deriveAudience(selected.length)

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        "relative mt-5 overflow-hidden rounded-lg bg-paper-sunken",
        "bg-[radial-gradient(var(--pl-ink-faint)_1px,transparent_1px)] [background-size:16px_16px]"
      )}
      style={{ height: STAGE_HEIGHT }}
    >
      {width > 0 && (
        <svg
          className="absolute inset-0"
          width={width}
          height={STAGE_HEIGHT}
          viewBox={`0 0 ${width} ${STAGE_HEIGHT}`}
          fill="none"
        >
          {CIRCLE_SEATS.map((seat) => {
            const sx = (SEAT_POS[seat.id].x / 100) * width
            const sy = (SEAT_POS[seat.id].y / 100) * STAGE_HEIGHT
            const dx = sx - cx
            const dy = sy - cy
            const len = Math.hypot(dx, dy) || 1
            const x1 = cx + (dx / len) * ringR
            const y1 = cy + (dy / len) * ringR
            const x2 = sx - (dx / len) * seatR
            const y2 = sy - (dy / len) * seatR
            const on = selected.includes(seat.id)
            return (
              <motion.line
                key={seat.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                strokeWidth={1.5}
                className="stroke-ink"
                initial={false}
                animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
                transition={{ duration: reduce ? 0 : DURATION_UI, ease: EASE_OUT_EXPO }}
              />
            )
          })}
        </svg>
      )}

      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${RING.x}%`, top: `${RING.y}%` }}
      >
        <AudienceRing audience={audience} viewerCount={selected.length} size={RING.size} stroke={5} drawIn>
          {/* Not Avatar: it derives initials, and "You" would read "YO". */}
          <span className="grid h-12 w-12 place-items-center rounded-full bg-ink text-caption font-bold text-paper">
            You
          </span>
        </AudienceRing>
      </div>

      {CIRCLE_SEATS.map((seat) => {
        const on = selected.includes(seat.id)
        const isSurprise = seat.id === SURPRISE_FOR
        return (
          <div
            key={seat.id}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${SEAT_POS[seat.id].x}%`, top: `${SEAT_POS[seat.id].y}%` }}
          >
            <div className="relative grid h-12 w-12 place-items-center">
              <span className="absolute inset-0 grid place-items-center rounded-full border-2 border-dashed border-line-strong">
                <Plus className="h-4 w-4 text-ink-subtle" />
              </span>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.span
                    key={isSurprise ? `seat-${wobble}` : "seat"}
                    className="absolute inset-0"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    animate={
                      isSurprise && !reduce
                        ? { opacity: 1, scale: 1, rotate: [0, -8, 8, 0] }
                        : { opacity: 1, scale: 1 }
                    }
                    exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    transition={
                      isSurprise && !reduce
                        ? { ...SPRING_GENTLE, rotate: { duration: 0.32, ease: "easeOut", delay: 0.12 } }
                        : SPRING_GENTLE
                    }
                  >
                    <Avatar firstName={seat.firstName} lastName={seat.lastName} size={48} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <span className="mt-1 text-caption font-semibold text-ink-muted">{seat.firstName}</span>
          </div>
        )
      })}
    </div>
  )
}
