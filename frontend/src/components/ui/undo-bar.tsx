"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Undo2 } from "lucide-react"
import { ModalPortal } from "@/components/ui/modal-portal"
import { SPRING_STANDARD } from "@/lib/animations"

/**
 * Undo instead of confirm.
 *
 * A confirmation dialog asks a question the user has already answered. It stops
 * every deletion — including the 95% that were meant — to guard against the 5%
 * that were not, and it teaches people to click through dialogs without reading.
 * Doing the thing and offering to take it back costs nothing when the action was
 * intended, and costs one click when it was not.
 *
 * This defers the REQUEST, not just the UI. The card disappears at once, but the
 * DELETE is only sent when the window closes; undo cancels the timer and nothing
 * ever reaches the server. That matters because the API has no restore endpoint —
 * an optimistic delete with a "restore" button would be a lie.
 *
 * A confirmation still belongs on anything this cannot cover: deleting an account,
 * revoking every session. Those are irreversible on the server, and a five-second
 * window is not consent.
 */

export interface PendingAction {
  /** Shown in the bar. "Task deleted", "3 tasks deleted". */
  label: string
  /** Runs when the window closes without an undo. */
  commit: () => void | Promise<void>
  /** Runs if the user takes it back. */
  rollback: () => void
}

/** How long the user has to change their mind. */
const WINDOW_MS = 5000

export function useUndoableAction() {
  const [pending, setPending] = useState<PendingAction | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const run = useCallback(
    (action: PendingAction) => {
      /**
       * A second action while one is still pending commits the first immediately
       * rather than dropping it. Dropping it would lose the deletion silently;
       * queueing would let the user stack five bars they cannot read.
       */
      setPending((prev) => {
        if (prev) {
          clear()
          void prev.commit()
        }
        return action
      })
      timer.current = setTimeout(() => {
        setPending((p) => {
          if (p === action) void action.commit()
          return null
        })
      }, WINDOW_MS)
    },
    [clear],
  )

  const undo = useCallback(() => {
    clear()
    setPending((p) => {
      p?.rollback()
      return null
    })
  }, [clear])

  /**
   * On unmount, COMMIT anything still pending — do not just drop the timer.
   *
   * The user asked for the deletion; navigating away is not taking it back. Only
   * clearing the timeout would leave the task on the server while it had already
   * vanished from the list, and it would reappear on the next load.
   */
  const pendingRef = useRef<PendingAction | null>(null)
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      const stillPending = pendingRef.current
      if (stillPending) void stillPending.commit()
    },
    [],
  )

  return { pending, run, undo }
}

export function UndoBar({ pending, onUndo }: { pending: PendingAction | null; onUndo: () => void }) {
  const reduce = useReducedMotion() ?? false

  return (
    <ModalPortal>
      <AnimatePresence>
        {pending && (
          <motion.div
            // `toast`, above the modal layer: an undo the user cannot see is not an
            // undo, and a dialog must never cover it.
            className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={SPRING_STANDARD}
          >
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-auto relative flex w-full max-w-md items-center gap-4 overflow-hidden rounded-xl bg-ink px-5 py-3 shadow-xl"
            >
              <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-paper">
                {pending.label}
              </span>
              <button
                type="button"
                onClick={onUndo}
                className="touch-target flex flex-shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-body-sm font-bold text-paper transition-colors hover:bg-paper/15"
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                Undo
              </button>

              {/* The window, draining. Linear on purpose: an eased countdown
                  misrepresents how much time is actually left. */}
              {!reduce && (
                <motion.span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-paper/40"
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: WINDOW_MS / 1000, ease: "linear" }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  )
}

export { WINDOW_MS as UNDO_WINDOW_MS }
