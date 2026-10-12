"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { Keyboard } from "lucide-react"
import { KeyLegendRow, useLitKey } from "@/components/ui/key-legend"
import { OPEN_SHORTCUTS_EVENT } from "@/components/ui/shortcuts-overlay"
import { FIELD_LABEL_CLASS } from "@/components/ui/field-label"
import { DURATION_FAST, DURATION_INSTANT, DURATION_SLOW } from "@/lib/animations"
import type { LegendKey } from "@/lib/landing-keys"
import { getBoolPreference, setBoolPreference } from "@/lib/ui-preferences"
import { useInert } from "@/hooks/use-inert"
import { cn } from "@/lib/utils"

/**
 * The keys every task card answers to, on the dashboard — folded away until asked for.
 *
 * The landing page teaches the keyboard with a legend that lights up as keys are pressed,
 * and nothing inside the app said a word about it: the `?` map exists, but only for
 * someone who already knows to press `?`. This is the same legend, the same eight keys in
 * the same words, kept where people start their day and out of their way:
 *
 * - **Folded by default**, behind a key cap in the list's heading — the toggle is drawn
 *   as a key: a raised cap on a ledge that goes down when pressed and stays down while the
 *   panel is open. It is shown only to a device with a hovering pointer: a phone has no
 *   keyboard to teach, and an extra control in its heading is noise.
 * - **It opens the way the New task plate opens**: its grid row grows on `slow` with the
 *   emphasized curve while the content fades in behind it, and the rows pour out one after
 *   another — no new motion, the list below simply moves down out of the way.
 * - **It answers.** A key that just did something lights its row (`useLitKey`, fed by the
 *   list and the priority keys through `lib/key-echo.ts`), so the panel reads as a
 *   live instrument rather than a reference card.
 * - **It says the one thing a map cannot**: these keys work on every task card, wherever
 *   it is shown.
 *
 * Open or folded is remembered on this device. The server has no storage, so the panel is
 * restored after mount — in one step, before the list's own entrance has drawn anything
 * under it, so nothing visible moves.
 */

export const KEY_HINTS_PREFERENCE = "dashboardKeyHintsOpen"

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

/** Between one row's arrival and the next, after the panel has started to open. */
const ROW_FIRST_MS = 60
const ROW_STEP_MS = 25

/** Open or folded, remembered per device; restored after mount without a glide. */
export function useKeyHints() {
  const [open, setOpen] = useState(false)
  /** True for the render that restores a remembered "open": that one must not glide. */
  const [restoring, setRestoring] = useState(false)

  useLayoutEffect(() => {
    if (!getBoolPreference(KEY_HINTS_PREFERENCE)) return
    setRestoring(true)
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!restoring) return
    const frame = requestAnimationFrame(() => setRestoring(false))
    return () => cancelAnimationFrame(frame)
  }, [restoring])

  const openRef = useRef(open)
  openRef.current = open
  const toggle = useCallback(() => {
    const next = !openRef.current
    setOpen(next)
    setBoolPreference(KEY_HINTS_PREFERENCE, next)
  }, [])

  return { open, toggle, restoring }
}

/**
 * The cap in the list's heading. Raised on its ledge at rest; pressed down while held, and
 * while the panel it opens is open.
 */
export function KeyHintsToggle({
  open,
  onToggle,
  controls,
}: {
  open: boolean
  onToggle: () => void
  /** The panel's id. */
  controls: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      title={open ? "Hide the keyboard" : "Show the keyboard"}
      className={cn(
        "touch-target group hidden h-9 items-center gap-2 rounded-md border px-3 text-body-sm font-semibold",
        "transition-[transform,box-shadow,background-color,color,border-color] duration-fast ease-emphasized",
        // Hover devices only — see the component's note.
        "[@media(hover:hover)]:inline-flex",
        open
          ? "translate-y-0.5 border-ink bg-ink text-paper shadow-none"
          : cn(
              "border-line-strong bg-paper text-ink-muted shadow-[0_2px_0_var(--pl-line-strong)]",
              "hover:border-ink hover:text-ink hover:shadow-[0_2px_0_var(--pl-ink)]",
              "active:translate-y-0.5 active:shadow-none",
            ),
      )}
    >
      <Keyboard className="h-4 w-4" aria-hidden="true" />
      Keys
    </button>
  )
}

/**
 * The legend itself. Always mounted, so it can fold away rather than vanish; out of the
 * tab order and the accessibility tree while folded (`inert`), the way the New task plate's
 * form is.
 */
export function KeyHintsPanel({ id, open, restoring = false }: { id: string; open: boolean; restoring?: boolean }) {
  const reduce = useReducedMotion() ?? false
  const titleId = useId()
  const lit = useLitKey({ enabled: open })
  const rootRef = useRef<HTMLDivElement>(null)
  useInert(rootRef, !open)
  /*
   * Every opening replays the rows' arrival: the rows are keyed by it, so they mount again
   * with their entrance. A remembered "open" restored on mount is not an opening — its rows
   * carry no entrance at all, or giving them one a frame later would replay it on rows
   * already on screen.
   */
  const [opening, setOpening] = useState(0)
  const wasOpen = useRef(open)
  useEffect(() => {
    if (open && !wasOpen.current && !restoring) setOpening((n) => n + 1)
    wasOpen.current = open
  }, [open, restoring])

  const still = reduce || restoring
  const rowsArrive = opening > 0 && !reduce
  const rowTransition = still
    ? "grid-template-rows 0.01s linear"
    : `grid-template-rows ${DURATION_SLOW}s var(--pl-ease-emphasized)`
  const contentTransition = still
    ? "opacity 0.01s linear"
    : `opacity ${open ? `${DURATION_FAST}s ${DURATION_FAST}s` : `${DURATION_INSTANT}s 0s`} var(--pl-ease-emphasized)`

  let order = 0
  return (
    <div
      ref={rootRef}
      id={id}
      aria-hidden={!open}
      style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: rowTransition }}
    >
      <div className="min-h-0 overflow-hidden">
        <div style={{ opacity: open ? 1 : 0, transition: contentTransition }} className="pt-4">
          <section
            aria-labelledby={titleId}
            className="rounded-xl border border-line bg-paper p-5 shadow-sm sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-ink text-paper">
                  <Keyboard className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 id={titleId} className="text-body-sm font-bold tracking-tight text-ink">
                    Keyboard
                  </h3>
                  <p className="mt-0.5 text-caption font-semibold text-ink-muted">
                    These keys work on every task card, wherever you find one.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))}
                className="touch-target inline-flex min-h-control items-center gap-2 rounded-md px-2 text-caption font-semibold text-ink-muted transition-colors duration-fast hover:text-ink"
              >
                Every shortcut
                <kbd
                  aria-hidden="true"
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line bg-paper-sunken px-1.5 font-sans text-caption font-semibold text-ink-muted"
                >
                  ?
                </kbd>
              </button>
            </div>

            <div key={opening} className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {GROUPS.map((group) => (
                <div key={group.title} className="min-w-0">
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
                          className={rowsArrive ? "animate-fade-in [animation-fill-mode:both]" : undefined}
                          style={rowsArrive ? { animationDelay: `${delay}ms` } : undefined}
                        />
                      )
                    })}
                  </dl>
                </div>
              ))}
            </div>

            <p className="mt-5 border-t border-line pt-4 text-caption text-ink-muted">
              Try one now — the key you press lights up here.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
