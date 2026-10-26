"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type RefObject } from "react"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { Keyboard, X } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { useEnter } from "@/components/animated/entrance"
import { isKeyboardFocus } from "@/components/layout/droplet"
import { KeyLegendRow, useLitKey } from "@/components/ui/key-legend"
import { KeyCombo, OPEN_SHORTCUTS_EVENT } from "@/components/ui/shortcuts-overlay"
import { FIELD_LABEL_CLASS } from "@/components/ui/field-label"
import { SPRING_LAYOUT, SPRING_STANDARD, TAP_PRESS, TWEEN_FAST } from "@/lib/animations"
import type { LegendKey } from "@/lib/landing-keys"
import { cn } from "@/lib/utils"

/**
 * The keys every task card answers to, kept in the corner of the dashboard until asked for.
 *
 * It used to be a "Keys" cap in the list's heading — a raised key on a ledge, the only
 * control of its kind in the product — that folded a full-width panel out over the list and
 * pushed every card down. Now it is a droplet: the same glass, border and shadow as the
 * app's bar, floating in the bottom-right corner, reserved for the task controls on a
 * phone.
 *
 * - **At rest** it is a 48px circle with a keyboard in it. Pointing at it, or reaching it with
 *   Tab, stretches it sideways to say "Shortcuts" — it names itself before it is pressed.
 * - **Pressed**, the circle becomes the panel: one surface springs from the corner to the
 *   panel's size (`SPRING_LAYOUT`), its content held at its natural scale and revealed by the
 *   growing edge, then the rows arrive one after another. The way back is the same spring.
 *   Nothing else on the page moves.
 * - **It answers.** While open, a key that just did something lights its row (`useLitKey`,
 *   fed by the list and the priority keys through `lib/key-echo.ts`), so the panel is a live
 *   instrument rather than a reference card — and it stays open while the keys are tried.
 * - **It is a region, not a dialog.** The priority keys ignore a key typed inside a dialog,
 *   and this panel exists to be tried with exactly those keys, so it is a labelled section:
 *   no focus trap, no scrim. It closes from its ✕, with Escape while focus is inside, or by
 *   pressing the corner again.
 *
 * Shown only to a device with a hovering pointer: a phone has no keyboard to teach.
 */

interface Group {
  title: string
  rows: { keys: LegendKey; does: string; note?: string }[]
}

/** The landing console's eight keys, in its words, grouped the way a hand reaches for them. */
const GROUPS: Group[] = [
  {
    title: "Move and open",
    rows: [
      { keys: "J K", does: "Move the cursor" },
      { keys: "⏎", does: "Open the branch" },
      { keys: "E", does: "Edit the title in place" },
    ],
  },
  {
    title: "Change",
    rows: [
      { keys: "Space", does: "Complete the task" },
      { keys: "1–5", does: "Set priority", note: "Point at a card, or move to it" },
      { keys: "Delete", does: "Delete, with five seconds to undo" },
    ],
  },
  {
    title: "Anywhere",
    rows: [
      { keys: "Mod K", does: "The command palette" },
      { keys: "?", does: "The keyboard map itself" },
    ],
  },
]

/** The first row arrives once the surface has visibly started to open; the rest follow it. */
const ROW_FIRST_MS = 90
const ROW_STEP_MS = 25

/**
 * One radius for every shape the surface takes: a full circle at 48px, a full pill at 48px
 * tall, and a soft panel corner. Kept constant so the spring only has to move the edges.
 */
const SURFACE_RADIUS = 24

/** The resting droplet: 48px, a 20px keyboard with 14px of glass round it. */
const CIRCLE = 48

export function KeyHintsDock({ hidden = false }: { hidden?: boolean }) {
  const reduce = useReducedMotion() ?? false
  const [open, setOpen] = useState(false)
  const [peek, setPeek] = useState(false)
  /** The surface's size: always the size of what it currently holds, measured. */
  const [size, setSize] = useState({ width: CIRCLE, height: CIRCLE })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  /** Set when the panel closes with focus inside it: the circle takes focus back once it is there. */
  const refocusTrigger = useRef(false)
  const entrance = useEnter("chip", { at: 480 })

  const close = useCallback(() => {
    const active = document.activeElement
    refocusTrigger.current = !!panelRef.current && !!active && panelRef.current.contains(active)
    setPeek(false)
    setOpen(false)
  }, [])

  /*
   * The surface does not size itself from its content: both faces are pinned to its
   * bottom-right corner at their natural size, and the surface's own width and height spring
   * to the face it holds. So the edge that moves is the top-left one, and it uncovers or
   * covers a face that stays exactly where it will rest — nothing inside is ever scaled or
   * slid. Measured before paint on every change of face, and again whenever a face resizes
   * (the label arriving, the viewport narrowing the panel).
   */
  useLayoutEffect(() => {
    if (hidden) return
    const face = open ? panelRef.current : triggerRef.current
    if (!face) return
    const measure = () => setSize({ width: face.offsetWidth, height: face.offsetHeight })
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(face)
    return () => observer.disconnect()
  }, [open, hidden])

  useEffect(() => {
    if (open) {
      // Focus goes to the panel itself, which draws no ring — opening shows the panel, it does
      // not light up a control in it. From here Tab reaches the panel's links, and the card
      // keys keep working, because a region is not a dialog.
      panelRef.current?.focus({ preventScroll: true })
    } else if (refocusTrigger.current) {
      refocusTrigger.current = false
      triggerRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  if (hidden) return null

  // Open and close travel far, so they take the layout spring; the label's small stretch takes
  // the droplet's own, the one the app bar settles with.
  const spring = reduce ? { duration: 0 } : open || size.height > CIRCLE ? SPRING_LAYOUT : SPRING_STANDARD

  return (
    <div
      className={cn(
        // `fixed`, moving itself and never an ancestor: a transformed ancestor would re-anchor it.
        "pointer-events-none fixed bottom-0 right-0 z-sticky hidden items-end justify-end pb-safe-4 pr-4 sm:pb-6 sm:pr-6",
        "[@media(hover:hover)]:flex",
        entrance.className,
      )}
      style={entrance.style}
    >
      <motion.div
        initial={false}
        animate={size}
        transition={spring}
        style={{ borderRadius: SURFACE_RADIUS }}
        className="pointer-events-auto relative overflow-hidden bg-paper/90 shadow-lg backdrop-blur-xl"
      >
        {/* The hairline is drawn over the faces, not round them, so the surface's size is
            exactly the face's and nothing is clipped by a border's width. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] border border-line/80" />
        <AnimatePresence initial={false}>
          {open ? (
            <HintsPanel key="panel" panelRef={panelRef} onClose={close} reduce={reduce} />
          ) : (
            <motion.button
              key="trigger"
              ref={triggerRef}
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: reduce ? { duration: 0 } : { ...TWEEN_FAST, delay: 0.12 } }}
              exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.06 } }}
              whileTap={TAP_PRESS}
              onClick={() => setOpen(true)}
              onPointerEnter={() => setPeek(true)}
              onPointerLeave={() => setPeek(false)}
              onFocus={(event: FocusEvent<HTMLButtonElement>) => {
                if (isKeyboardFocus(event.target)) setPeek(true)
              }}
              onBlur={() => setPeek(false)}
              aria-label="Keyboard shortcuts"
              aria-expanded={false}
              // The label comes first and the keyboard last: pinned to the right, the keyboard
              // stays put while the label is uncovered to its left.
              className={cn(
                "absolute bottom-0 right-0 flex h-12 items-center gap-2 whitespace-nowrap rounded-full pr-3.5 text-ink-muted transition-colors duration-fast",
                peek ? "pl-4" : "pl-3.5",
                "hover:text-ink focus-visible:-outline-offset-4",
              )}
            >
              {peek && (
                <motion.span
                  aria-hidden="true"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: reduce ? { duration: 0 } : { ...TWEEN_FAST, delay: 0.05 } }}
                  className="text-body-sm font-semibold"
                >
                  Shortcuts
                </motion.span>
              )}
              <Keyboard className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function HintsPanel({
  panelRef,
  onClose,
  reduce,
}: {
  panelRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  reduce: boolean
}) {
  const titleId = useId()
  const lit = useLitKey({ enabled: true })

  let order = 0
  return (
    <motion.div
      ref={panelRef}
      role="region"
      tabIndex={-1}
      aria-labelledby={titleId}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: reduce ? { duration: 0 } : { ...TWEEN_FAST, delay: 0.04 } }}
      exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.12 } }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        // The panel's Escape, aimed at the panel: the list's own Escape should not also run.
        event.stopPropagation()
        onClose()
      }}
      className="absolute bottom-0 right-0 w-[22rem] max-w-[calc(100vw-2rem)] outline-none"
    >
      <div className="flex items-start gap-3 py-4 pl-5 pr-3">
        <span aria-hidden="true" className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-ink text-paper">
          <Keyboard className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 id={titleId} className="text-body-sm font-bold tracking-tight text-ink">
            Keyboard shortcuts
          </h2>
          <p className="mt-0.5 text-caption text-ink-muted">They work on every task card.</p>
        </div>
        <motion.button
          type="button"
          whileTap={TAP_PRESS}
          onClick={onClose}
          aria-label="Close keyboard shortcuts"
          className="-mt-1 grid h-11 w-11 flex-shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </motion.button>
      </div>

      <div className="max-h-[min(26rem,calc(100vh-12rem))] space-y-4 overflow-y-auto border-t border-line px-5 py-4">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className={FIELD_LABEL_CLASS}>{group.title}</p>
            <dl className="mt-2 flex flex-col gap-1.5">
              {group.rows.map((row) => {
                const delay = ROW_FIRST_MS + ROW_STEP_MS * order++
                return (
                  <KeyLegendRow
                    key={row.keys}
                    keys={row.keys}
                    does={row.does}
                    note={row.note}
                    lit={lit === row.keys}
                    className={reduce ? undefined : "animate-fade-in [animation-fill-mode:both]"}
                    style={reduce ? undefined : { animationDelay: `${delay}ms` }}
                  />
                )
              })}
            </dl>
          </div>
        ))}
        <div className="flex items-center gap-3 text-body-sm text-ink-muted">
          <KeyCombo keys={["C"]} />
          <span>New task</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line py-2 pl-5 pr-3">
        <p className="text-caption text-ink-muted">Press one — its row lights up.</p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))}
          className="touch-target inline-flex min-h-control items-center gap-2 rounded-full px-2.5 text-caption font-semibold text-ink-muted transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
        >
          All shortcuts
          <kbd
            aria-hidden="true"
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line bg-paper-sunken px-1.5 font-sans text-caption font-semibold text-ink-muted"
          >
            ?
          </kbd>
        </button>
      </div>
    </motion.div>
  )
}
