"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, useInView, useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { ShieldCheck } from "lucide-react"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import { NumberRoll } from "@/components/ui/number-roll"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import {
  ceilingCaption,
  deriveAudience,
  isAtSharingCeiling,
  ringCountNoun,
  ringReading,
  type RingReading,
} from "@/lib/landing-audience"
import { DURATION_FAST, DURATION_UI, EASE_EXIT, EASE_OUT_EXPO, SPRING_STANDARD } from "@/lib/animations"
import { cn } from "@/lib/utils"
import { AudienceRing } from "./audience-ring"
import { FIXTURE_FRIENDS } from "./fixtures"
import { SeatRail } from "./seat-rail"

const SWEEP_TO = 3
const SWEEP_STEP_MS = 220

/**
 * Block 2 — reading the ring.
 *
 * The ring sits on every task you share, so the useful thing this block can teach is how to
 * read it at a glance. The left half is the gauge: the ring and the count in its centre. The
 * right half is the control — a row of seats you slide a ring along (`SeatRail`) — and a
 * legend you can keep: private, shared, past the ceiling, and the promise under all three —
 * protected, always.
 *
 * The geometry is the product's: `AudienceRing` draws from `redactionArc`, so the cut widens
 * 4.5% a person from 16% and saturates at half the circumference at eight — the same numbers
 * the 14px badge uses. Past eight the ring holds still while the count keeps going, and the
 * legend and the sentence say that the stillness is the design, not a stuck control.
 *
 * **The ring never closes.** Private is a ring with one narrow cut and you at its centre;
 * every person you add opens it wider; and nothing in Planora is ever published — no link to
 * hand out, no publish button, and sharing with every friend is still a circle you chose. The
 * last legend row says so, drawn with a shield rather than a closed ring, because a closed
 * ring is a state the product never shows. It is named "Protected", not "Public · not
 * possible": the owner's rule is that the word is never shown, not even to deny it.
 *
 * The count is centred in its reserved two-digit box (`NumberRoll align="center"`), so a
 * single digit sits in the middle of the ring rather than right of an empty column.
 *
 * On first sight, and only if the visitor has not touched anything, the count sweeps 0 → 3 so
 * the ring visibly opens three times and three seats fill; then it hands over. The stage, the
 * marker and the sentence hold reserved sizes: the panel's height never depends on the count.
 */
export function SharingCeiling() {
  const reduce = useReducedMotion() ?? false
  const [count, setCount] = useState(0)
  const [touched, setTouched] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const seen = useInView(stageRef, { once: true, amount: 0.5 })

  // The one-time sweep. Any interaction flips `touched`, which clears the pending steps.
  useEffect(() => {
    if (!seen || touched) return
    if (reduce) {
      setCount(SWEEP_TO)
      return
    }
    const timers = Array.from({ length: SWEEP_TO }, (_, i) =>
      setTimeout(() => setCount(i + 1), 400 + i * SWEEP_STEP_MS)
    )
    return () => timers.forEach(clearTimeout)
  }, [seen, touched, reduce])

  const reading = ringReading(count)
  const caption = ceilingCaption(count)

  return (
    <div className="grid grid-cols-1 items-center gap-10 rounded-xl border border-line bg-paper-raised p-6 shadow-lg sm:p-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
      {/* ── The gauge. A picture of the right-hand column's facts, so aria-hidden. ── */}
      <div
        ref={stageRef}
        aria-hidden="true"
        className={cn(
          "relative flex h-80 flex-col items-center justify-center rounded-lg bg-paper-sunken lg:h-auto lg:min-h-80 lg:self-stretch",
          "bg-[radial-gradient(var(--pl-ink-faint)_1px,transparent_1px)] [background-size:16px_16px]"
        )}
      >
        {/* The ceiling marker, over the cut at twelve o'clock. Space reserved either way. */}
        <div className="flex h-8 items-end">
          <AnimatePresence>
            {isAtSharingCeiling(count) && (
              <motion.span
                className="flex flex-col items-center"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
              >
                <span className="rounded-full bg-ink px-2.5 py-0.5 text-caption font-semibold text-paper">
                  Stops widening
                </span>
                <span className="h-2 w-px bg-ink" />
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-1 grid h-56 w-56 place-items-center">
          {seen && (
            <AudienceRing audience={deriveAudience(count)} viewerCount={count} size={224} stroke={5} drawIn>
              <span className="flex flex-col items-center">
                <span className="text-display font-bold tracking-tight text-ink">
                  <NumberRoll value={count} minDigits={2} align="center" />
                </span>
                {/* Reserved to its longest word so "person" ↔ "just you" moves nothing. */}
                <span className="inline-grid text-caption font-semibold uppercase tracking-wider text-ink-muted">
                  <span className="invisible [grid-area:1/1]">just you</span>
                  <span className="text-center [grid-area:1/1]">{ringCountNoun(count)}</span>
                </span>
              </span>
            </AudienceRing>
          )}
        </div>
      </div>

      {/* ── The control, the legend, the reading. ── */}
      <div>
        <p id="ring-people" className={FIELD_LABEL_CLASS}>
          People who can see it
        </p>
        <div className="mt-3">
          <SeatRail
            value={count}
            labelledBy="ring-people"
            friends={FIXTURE_FRIENDS}
            onChange={(n) => {
              setTouched(true)
              setCount(n)
            }}
          />
        </div>

        <ul className="mt-8 flex flex-col gap-2">
          {LEGEND.map((row) => (
            <LegendRow key={row.id} row={row} on={row.id === reading} />
          ))}
          <li className="relative flex items-start gap-4 rounded-md border border-dashed border-line-strong px-4 py-3">
            <ShieldCheck className="mt-px h-[18px] w-[18px] flex-shrink-0 text-ink" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-body-sm font-bold text-ink">Protected</span>
                <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-caption font-semibold text-ink-muted">
                  Always
                </span>
              </span>
              <span className="mt-0.5 block text-pretty text-body-sm text-ink-muted">
                Nothing in Planora is ever published: no link to hand out, no publish button.
                Even shared with every friend, a task stays with the people you chose, and the
                ring only counts them.
              </span>
            </span>
          </li>
        </ul>

        {/* The block's one live region, reserved at two lines. */}
        <p aria-live="polite" className="relative mt-6 min-h-12 text-pretty text-body-sm font-semibold text-ink">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={caption}
              className="block"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } }}
              exit={{ opacity: 0, y: reduce ? 0 : -8, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }}
            >
              {caption}
            </motion.span>
          </AnimatePresence>
        </p>

        <p className="mt-3 text-body-sm text-ink-muted">
          Not built yet: showing different people different parts of the same task. Today a
          task is shared whole or not at all.
        </p>
      </div>
    </div>
  )
}

interface LegendEntry {
  id: RingReading
  name: string
  line: string
  mark: { audience: "private" | "shared"; viewers?: number }
}

const LEGEND: LegendEntry[] = [
  {
    id: "private",
    name: "Private",
    line: "Only you. The filled dot in the middle is you.",
    mark: { audience: "private" },
  },
  {
    id: "shared",
    name: "Shared",
    line: "Each person you add opens the ring a little wider.",
    mark: { audience: "shared", viewers: 3 },
  },
  {
    id: "ceiling",
    name: "Past eight",
    line: "The ring stops widening so it still reads as a ring. The number keeps counting.",
    mark: { audience: "shared", viewers: 8 },
  },
]

function LegendRow({ row, on }: { row: LegendEntry; on: boolean }) {
  return (
    <li
      className={cn(
        "relative flex items-start gap-4 overflow-hidden rounded-md border px-4 py-3 transition-colors duration-fast",
        on ? "border-ink bg-paper" : "border-line"
      )}
    >
      {on && (
        <motion.span
          layoutId="ring-legend-bar"
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-ink"
          transition={SPRING_STANDARD}
        />
      )}
      <span className="mt-0.5">
        <RedactionBadge audience={row.mark.audience} viewerCount={row.mark.viewers} showLabel={false} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-bold text-ink">
          {row.name}
          {on && <span className="sr-only"> (the current reading)</span>}
        </span>
        <span className="mt-0.5 block text-body-sm text-ink-muted">{row.line}</span>
      </span>
    </li>
  )
}
