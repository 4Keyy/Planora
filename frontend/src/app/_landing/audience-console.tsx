"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { Check, Minus, Plus } from "lucide-react"
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
 * share it with Victoria and Tom. Adding Mira is allowed, and the card says what that does to
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
 * - **The seats are pressable, and the chips stay the control.** A plus on an empty seat is
 *   an invitation, and a visitor who presses it expects that person to join; the seat used
 *   to be a picture of a button that did nothing. The seats are pointer targets only
 *   (`tabIndex={-1}` inside the `aria-hidden` stage): the chips below carry the same
 *   toggle with its name and pressed state, so the keyboard and a screen reader get it
 *   once, where it is labelled.
 * - **The stage is `aria-hidden`.** It restates the sentence as a picture; a screen reader
 *   gets the sentence once and the toggles with their pressed state.
 * - **The hint is bounded.** If nobody has pressed anything after a moment, the first
 *   seat's plus sends out two rings and stops for good. Nothing on this card moves at rest
 *   after that.
 */

/** Seat centres on the stage, in percent of its width and height. */
const SEAT_POS: Record<SeatId, { x: number; y: number }> = {
  victoria: { x: 16, y: 30 },
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
    // Outside the updater: updaters must be pure, and StrictMode runs them twice.
    if (!selected.includes(id) && id === SURPRISE_FOR) setWobble((w) => w + 1)
    // From the latest selection, not this render's: a seat and a chip pressed inside one
    // frame both land, where the second used to overwrite the first.
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-5 shadow-xl sm:p-7">
      {/* The task, as a row in the app would show it. The badge is the shipped one; its
          slot is a fixed width so "Private" ↔ "Shared 3" never reflows the title. */}
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-6 w-6 flex-shrink-0 rounded-full border-2 border-line-strong" />
        <p className="min-w-0 flex-1 text-body font-semibold text-ink">{CIRCLE_TASK_TITLE}</p>
        <span className="flex w-24 flex-shrink-0 justify-end">
          <RedactionBadge audience={audience} viewerCount={count} size="sm" />
        </span>
      </div>

      <Stage
        selected={selected}
        wobble={wobble}
        reduce={reduce}
        hint={hint}
        onToggle={toggle}
        onHintDone={() => setHint(false)}
      />

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
        {CIRCLE_SEATS.map((seat) => {
          const on = selected.includes(seat.id)
          return (
            <motion.button
              key={seat.id}
              type="button"
              onClick={() => toggle(seat.id)}
              // Named outright: an sr-only "Share with " prefix lost its trailing space in
              // the accessible name ("Share withVictoria"), and the avatar's initials are
              // not part of the name at all.
              aria-label={`Share with ${seat.firstName}`}
              aria-pressed={on}
              whileTap={reduce ? undefined : TAP_PRESS}
              className={cn(
                "relative inline-flex min-h-control items-center gap-2 rounded-full border py-1 pl-1.5 pr-4",
                "text-body-sm font-semibold transition-colors duration-fast",
                on
                  ? "border-ink bg-ink text-paper"
                  : "border-line-strong bg-paper text-ink hover:bg-paper-sunken"
              )}
            >
              <span aria-hidden="true" className="inline-flex">
                <Avatar firstName={seat.firstName} lastName={seat.lastName} size={32} />
              </span>
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
 *
 * A seat's CIRCLE is what sits on its coordinates. The name used to share a centred
 * column with it, which put the circle 10px above the point every line was aimed at; the
 * name now hangs below the circle, outside the box that is centred.
 */
function Stage({
  selected,
  wobble,
  reduce,
  hint,
  onToggle,
  onHintDone,
}: {
  selected: SeatId[]
  wobble: number
  reduce: boolean
  hint: boolean
  onToggle: (id: SeatId) => void
  onHintDone: () => void
}) {
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

      {CIRCLE_SEATS.map((seat, i) => {
        const on = selected.includes(seat.id)
        const isSurprise = seat.id === SURPRISE_FOR
        const hinting = hint && i === 0 && !on
        return (
          // Positioned by this wrapper, pressed on the button inside it: framer-motion
          // writes the whole `transform`, so a scale on the positioned node would wipe
          // out its -50% centring on the first frame of a hover.
          <div
            key={seat.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${SEAT_POS[seat.id].x}%`, top: `${SEAT_POS[seat.id].y}%` }}
          >
            <motion.button
              type="button"
              tabIndex={-1}
              // Named although the picture is aria-hidden: a pointer target with no name is
              // still a control nobody can describe, and the scan counts it as one.
              aria-label={on ? `Remove ${seat.firstName}` : `Add ${seat.firstName}`}
              onClick={() => onToggle(seat.id)}
              whileHover={reduce ? undefined : { scale: 1.06 }}
              whileTap={reduce ? undefined : TAP_PRESS}
              className={cn(
                "group relative grid h-12 w-12 cursor-pointer place-items-center rounded-full",
                // The name below the circle is part of the target: people aim at the word.
                "after:absolute after:-inset-x-4 after:-bottom-7 after:-top-2 after:content-['']"
              )}
            >
              {hinting && (
                <motion.span
                  className="pointer-events-none absolute inset-0 rounded-full border-2 border-ink"
                  initial={{ scale: 1, opacity: 0.5 }}
                  animate={{ scale: 1.6, opacity: 0 }}
                  transition={{ duration: 0.9, ease: EASE_OUT_EXPO, repeat: 1, repeatDelay: 0.2 }}
                  onAnimationComplete={onHintDone}
                />
              )}
              <span
                className={cn(
                  "absolute inset-0 grid place-items-center rounded-full border-2 border-dashed bg-paper-sunken",
                  "transition-colors duration-fast group-hover:border-solid group-hover:border-ink group-hover:bg-paper",
                  hinting ? "border-ink" : "border-line-strong"
                )}
              >
                <Plus
                  className={cn(
                    "h-4 w-4 transition-colors duration-fast group-hover:text-ink",
                    hinting ? "text-ink" : "text-ink-subtle"
                  )}
                />
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
                    {/* Pressing a person again lets them out: the minus says so before the press. */}
                    <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-paper-sunken bg-ink text-paper opacity-0 transition-opacity duration-fast group-hover:opacity-100">
                      <Minus className="h-3 w-3" strokeWidth={3} />
                    </span>
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
            <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-caption font-semibold text-ink-muted">
              {seat.firstName}
            </span>
          </div>
        )
      })}
    </div>
  )
}
