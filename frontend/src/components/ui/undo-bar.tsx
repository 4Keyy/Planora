"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useToastStore } from "@/store/toast"

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
 *
 * The offer itself is a notice like any other (`components/ui/toast.tsx`): it used to be
 * a black bar of its own at the bottom of the screen, which looked and moved nothing like
 * the notices in the top corner. The window pauses while the notice stack is being read,
 * and the ring round its mark is the window draining.
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
  /**
   * The pending action lives in a ref, and the ref is the only thing a side
   * effect ever reads. State merely mirrors it so the bar can render.
   *
   * It used to be the other way round: `commit` and `rollback` were called from
   * inside `setPending(prev => …)`. Updaters must be pure, and StrictMode calls
   * them twice in development to prove it, so one Undo rolled back twice (the
   * deleted task came back as two rows) and one superseded action was committed
   * twice (two DELETEs for one task).
   */
  const current = useRef<PendingAction | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The window's clock: what is left of it, and when it last started running. */
  const remaining = useRef(WINDOW_MS)
  const startedAt = useRef(0)

  /**
   * Read-and-clear, the one way an action leaves the ref. Whoever gets it back
   * is the only caller that may settle it; every later caller gets null. The
   * timer goes with it, so a window that has been settled early cannot close a
   * second time.
   */
  const take = useCallback((): PendingAction | null => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const action = current.current
    current.current = null
    return action
  }, [])

  const schedule = useCallback(
    (ms: number) => {
      startedAt.current = Date.now()
      timer.current = setTimeout(() => {
        // Every early exit clears this timer, so an action that reaches here is
        // still the pending one.
        const expired = take()
        if (!expired) return
        void expired.commit()
        setPending(null)
      }, ms)
    },
    [take],
  )

  const run = useCallback(
    (action: PendingAction) => {
      /**
       * A second action while one is still pending commits the first immediately
       * rather than dropping it. Dropping it would lose the deletion silently;
       * queueing would let the user stack five bars they cannot read.
       */
      const superseded = take()
      if (superseded) void superseded.commit()

      current.current = action
      setPending(action)
      remaining.current = WINDOW_MS
      schedule(WINDOW_MS)
    },
    [take, schedule],
  )

  /** The user is reading the offer: the window stops closing until they leave it. */
  const hold = useCallback(() => {
    if (!current.current || !timer.current) return
    clearTimeout(timer.current)
    timer.current = null
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
  }, [])

  const release = useCallback(() => {
    if (!current.current || timer.current) return
    schedule(remaining.current)
  }, [schedule])

  const undo = useCallback(() => {
    const undone = take()
    if (!undone) return
    undone.rollback()
    setPending(null)
  }, [take])

  /**
   * On unmount, COMMIT anything still pending — do not just drop the timer.
   *
   * The user asked for the deletion; navigating away is not taking it back. Only
   * clearing the timeout would leave the task on the server while it had already
   * vanished from the list, and it would reappear on the next load.
   */
  useEffect(
    () => () => {
      const stillPending = take()
      if (stillPending) void stillPending.commit()
    },
    [take],
  )

  return { pending, run, undo, hold, release }
}

/**
 * Puts the pending action's offer into the notice stack, and takes it out again when the
 * window closes or the action is taken back. Renders nothing itself: the `Toaster` in the
 * root layout draws every notice. `onHold` / `onRelease` pause the window while the stack
 * is being read — pass the hook's `hold` and `release`.
 */
export function UndoBar({
  pending,
  onUndo,
  onHold,
  onRelease,
}: {
  pending: PendingAction | null
  onUndo: () => void
  onHold?: () => void
  onRelease?: () => void
}) {
  const id = `undo-${useId()}`
  const addToast = useToastStore((state) => state.addToast)
  const removeToast = useToastStore((state) => state.removeToast)
  // The latest handlers, read when they fire: the notice outlives the render that made it.
  const handlers = useRef({ onUndo, onHold, onRelease })
  handlers.current = { onUndo, onHold, onRelease }

  useEffect(() => {
    if (!pending) return
    addToast({
      id,
      type: "info",
      icon: "undo",
      title: pending.label,
      action: { label: "Undo", onClick: () => handlers.current.onUndo() },
      duration: WINDOW_MS,
      countdown: true,
      onPause: () => handlers.current.onHold?.(),
      onResume: () => handlers.current.onRelease?.(),
    })
    return () => removeToast(id)
  }, [pending, id, addToast, removeToast])

  return null
}

export { WINDOW_MS as UNDO_WINDOW_MS }
