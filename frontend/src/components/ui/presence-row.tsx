"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Avatar } from "@/components/ui/avatar"
import { NumberRoll } from "@/components/ui/number-roll"
import { DURATION_SLOW, DURATION_UI, EASE_OUT_EXPO, EASE_STANDARD, SPRING_GENTLE, TWEEN_EXIT } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * The people inside a task, as faces — and an arrival as an event.
 *
 * Collaboration is this product's reason to exist and the interface spent it on a
 * numeral: a shared task rendered "3 participants". A count answers "how many",
 * which is the one question nobody arrives with; the questions are *who* and *did
 * someone just join*. A numeral answers neither, and it slides from 2 to 3 without
 * the eye registering that anything happened at all.
 *
 * So the stack shows faces, and the difference between two consecutive id sets is
 * treated as an event: the new face springs in and is ringed once, in the product's
 * accent, by a stroke that draws itself and then leaves. First mount is deliberately
 * NOT an event. A page load would otherwise ring every participant simultaneously
 * and teach the user, on their very first exposure, that the ring means nothing.
 *
 * Accessibility is where a presence stack usually fails. Labelling each avatar makes
 * a screen-reader user walk a crowd one person at a time to learn what a sighted
 * user takes in at a glance, and the arrival ring — decoration, carrying no
 * information a name does not already carry — would announce on every join. One
 * sentence states the whole fact instead; everything visual below it is aria-hidden.
 */

export interface PresenceMember {
  id: string
  name?: string | null
  avatarUrl?: string | null
}

export interface PresenceRowProps {
  members: PresenceMember[]
  /** How many are needed in total. When set, renders the "2 of 3" fraction. */
  required?: number | null
  /** Faces shown before collapsing into "+N". Default 4. */
  max?: number
  size?: "sm" | "md"
  className?: string
}

/**
 * One shared empty set, so "nobody arrived" is always the same reference and
 * `setState` can bail out instead of re-rendering the stack on every parent tick.
 */
const NO_ARRIVALS: Set<string> = new Set()

/**
 * Seconds between two arrivals landing.
 *
 * Three people joining in the same payload must read as three people. Entering
 * together they read as a single pop of movement and the count is lost; offset,
 * the eye separates them and counts. Small enough that one person joining alone
 * never feels delayed.
 */
const ARRIVAL_STAGGER_S = 0.06

const SIZES = {
  sm: { px: 24, overlap: "-ml-1.5", label: "text-caption" },
  md: { px: 32, overlap: "-ml-2", label: "text-body-sm" },
} as const

function sameIds(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

/**
 * Which of `ids` were not there on the previous distinct set of ids.
 *
 * Exported so the arrival rule can be tested as a rule rather than inferred from
 * whatever framer-motion happens to put in the DOM.
 *
 * Two things it must get right, and both are easy to get wrong:
 *
 * - **The first set is not an arrival.** Somebody who was already in the task when
 *   the page loaded did not just walk in. Without the `null` sentinel, every mount
 *   is a mass arrival.
 * - **An unchanged set must not clear the result.** The parent re-renders for
 *   reasons of its own — a sibling's state, a poll that returned identical data —
 *   and recomputing "nobody is new" on those renders would cut the ring off
 *   mid-draw. The early return is what keeps the event alive until the next real
 *   change.
 */
export function usePresenceArrivals(ids: string[]): Set<string> {
  const previous = useRef<Set<string> | null>(null)
  const [arrivals, setArrivals] = useState<Set<string>>(NO_ARRIVALS)

  useEffect(() => {
    const next = new Set(ids)
    const before = previous.current

    if (before && sameIds(before, next)) return
    previous.current = next
    if (!before) return

    const fresh = new Set<string>()
    for (const id of next) if (!before.has(id)) fresh.add(id)
    setArrivals(fresh.size > 0 ? fresh : NO_ARRIVALS)
  }, [ids])

  return arrivals
}

/** Avatar wants the halves; the API gives one string. */
function splitName(name: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") }
}

/**
 * The one sentence a screen reader hears. It names the first person and counts the
 * rest: a list of eight names is not a summary, it is the crowd again.
 */
function presenceSentence(members: PresenceMember[], required: number | null): string {
  const names = members.map((m) => m.name?.trim() || "Someone")
  const verb = names.length === 1 ? "is" : "are"

  const who =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names[0]} and ${names.length - 1} others`

  const fraction = required === null ? "" : ` ${members.length} of ${required} needed.`
  return `${who} ${verb} working on this.${fraction}`
}

export function PresenceRow({ members, required, max = 4, size = "md", className }: PresenceRowProps) {
  const reduce = useReducedMotion() ?? false
  const arrivals = usePresenceArrivals(members.map((m) => m.id))

  const s = SIZES[size]
  // `0` is the absence of a requirement, not a requirement of none.
  const need = typeof required === "number" && required > 0 ? required : null

  /**
   * Collapse only when it buys something. A `+1` chip is exactly as wide as the
   * face it replaces, so hiding a single overflowing person trades a human being
   * for a numeral and reclaims no space at all.
   */
  const visible = members.length > max + 1 ? members.slice(0, max) : members
  const hidden = members.length - visible.length

  // The order arrivals land in, so a single late joiner never waits behind the
  // positions of people who were already there.
  const arrivalOrder = visible.filter((m) => arrivals.has(m.id)).map((m) => m.id)

  // A solo task carries no chrome. Rendering an empty stack would put a permanent
  // reminder of collaboration on every private task a person owns.
  if (members.length === 0) return null

  return (
    /**
     * The row breathes once when somebody arrives — `scale 1 → 1.006 → 1`.
     *
     * This is BLUEPRINT moment 4, step 4, and it is the **only** purely decorative
     * motion the product allows itself. It earns the exception because of what it
     * marks: a person appearing inside your task is the central event of a
     * collaboration product, and nothing else in the interface is.
     *
     * 0.6% is deliberately below the threshold at which motion reads as an
     * animation. It reads as the row having been touched. Anything larger would
     * make a colleague joining feel like an alert.
     *
     * Keyed on the arriving ids, so it restarts for each real arrival and does
     * nothing on the re-renders in between; `false` on the first mount, for the
     * same reason the ring is — the people already here did not just walk in.
     */
    <motion.div
      key={[...arrivals].sort().join("|") || "settled"}
      initial={false}
      animate={arrivals.size > 0 && !reduce ? { scale: [1, 1.006, 1] } : { scale: 1 }}
      transition={{ duration: DURATION_SLOW, ease: EASE_STANDARD }}
      className={cn("inline-flex items-center gap-2.5", className)}
    >
      <span className="sr-only">{presenceSentence(members, need)}</span>

      <div aria-hidden="true" className="flex items-center">
        {/*
         * `initial={false}`: the faces already present on the first render appear,
         * they do not arrive. Anything AnimatePresence sees added afterwards is, by
         * definition, new since the last render — which is exactly the event.
         */}
        <AnimatePresence initial={false}>
          {visible.map((member, i) => {
            const { firstName, lastName } = splitName(member.name)
            const rank = arrivalOrder.indexOf(member.id)
            const delay = reduce || rank < 1 ? 0 : rank * ARRIVAL_STAGGER_S

            return (
              <motion.span
                key={member.id}
                // The paper ring is what makes overlapping heads separable. Without
                // it two dark avatars at 8px overlap read as one wide blob, and the
                // stack stops communicating a headcount.
                className={cn("relative inline-flex rounded-full ring-2 ring-paper", i > 0 && s.overlap)}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0, transition: TWEEN_EXIT }}
                transition={{ ...SPRING_GENTLE, delay }}
              >
                <Avatar src={member.avatarUrl} firstName={firstName} lastName={lastName} size={s.px} />

                {/*
                 * The arrival ring, drawn rather than flashed: `pathLength` sweeps
                 * the stroke round the face so the motion has a direction and a
                 * finish, then the whole thing fades and is gone. It is skipped
                 * entirely under reduced motion — a self-drawing stroke is the kind
                 * of decorative sweep that setting exists to refuse, and the
                 * sr-only sentence already carries the fact for everyone.
                 */}
                {arrivals.has(member.id) && !reduce && (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 100 100"
                    className="pointer-events-none absolute -inset-1 -rotate-90 text-accent"
                  >
                    <motion.circle
                      cx="50"
                      cy="50"
                      r="46"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="6"
                      strokeLinecap="round"
                      initial={{ pathLength: 0, opacity: 1 }}
                      animate={{ pathLength: 1, opacity: 0 }}
                      transition={{
                        pathLength: { duration: DURATION_UI, ease: EASE_OUT_EXPO, delay },
                        // Held until the stroke has closed, or the ring fades out
                        // of a circle it never finished drawing.
                        opacity: { ...TWEEN_EXIT, delay: DURATION_UI + delay },
                      }}
                    />
                  </svg>
                )}
              </motion.span>
            )
          })}
        </AnimatePresence>

        {hidden > 0 && (
          <span
            className={cn(
              "inline-flex items-center justify-center rounded-full border border-line bg-paper-sunken font-semibold tabular-nums text-ink-subtle ring-2 ring-paper",
              s.overlap,
              s.label,
            )}
            style={{ width: s.px, height: s.px }}
          >
            +{hidden}
          </span>
        )}
      </div>

      {need !== null && (
        // Rolled, not swapped. This numeral changes for the same reason the stack
        // does, and a hard swap beside an animated arrival reads as two unrelated
        // updates instead of one fact stated twice.
        //
        // aria-hidden, and not optionally: NumberRoll publishes its own sr-only
        // value, so without this the fraction is announced a second time and the
        // "one sentence" rule quietly stops holding.
        <span aria-hidden="true" className={cn("font-medium text-ink-subtle", s.label)}>
          <span className="font-semibold text-ink">
            <NumberRoll value={members.length} />
          </span>
          {" of "}
          {need}
        </span>
      )}
    </motion.div>
  )
}
