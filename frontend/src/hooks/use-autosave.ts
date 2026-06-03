"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Lifecycle of a single autosave channel.
 *
 * - `idle`   — nothing pending, no change since the last persisted baseline.
 * - `saving` — a persist request is in flight (or about to be retried).
 * - `saved`  — the latest value has been successfully persisted.
 * - `error`  — the last attempt failed; the next change retries automatically.
 */
export type AutosaveStatus = "idle" | "saving" | "saved" | "error"

export interface UseAutosaveOptions<T> {
  /** The live value to persist. Compared against the last-saved baseline on every change. */
  value: T
  /** Persist routine. Must reject (throw) on failure so the hook can surface `error`. */
  onSave: (value: T) => Promise<void>
  /** When false the hook is dormant: it never schedules or fires a save. */
  enabled?: boolean
  /** Debounce window in ms — coalesces bursts (typing, color-picker drags). Default 600. */
  delay?: number
  /** Equality test between two values. Default: identity then a structural JSON compare. */
  isEqual?: (a: T, b: T) => boolean
  /** Guard run against the pending value; returning false skips the save (e.g. empty name). */
  validate?: (value: T) => boolean
}

export interface UseAutosaveResult<T> {
  status: AutosaveStatus
  /** Persist any pending change immediately (cancels the debounce). Safe to call on close. */
  flush: () => Promise<void>
  /** Re-anchor the saved baseline without persisting — call when the edited entity changes. */
  reset: (value: T) => void
}

const defaultIsEqual = <T,>(a: T, b: T): boolean =>
  Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)

/**
 * Debounced, single-flight autosave for modal forms.
 *
 * Design guarantees:
 * - **No lost edits** — a change made while a save is in flight re-fires once that
 *   save settles; a pending debounce is flushed on unmount and on explicit `flush()`.
 * - **No redundant writes** — every persist is gated by an equality check against the
 *   last successfully saved snapshot, so reverting a field or re-flushing is a no-op.
 * - **No overlap** — at most one request is in flight at a time.
 * - **Safe after unmount** — status updates are suppressed once unmounted; the final
 *   flush is fire-and-forget and idempotent.
 */
export function useAutosave<T>({
  value,
  onSave,
  enabled = true,
  delay = 600,
  isEqual = defaultIsEqual,
  validate,
}: UseAutosaveOptions<T>): UseAutosaveResult<T> {
  const [status, setStatus] = useState<AutosaveStatus>("idle")

  // Everything the async machinery reads lives in refs so `run` keeps a stable identity
  // and always observes the freshest value/callbacks (never a stale closure).
  const valueRef = useRef(value)
  const savedRef = useRef(value) // last successfully persisted snapshot (the baseline)
  const onSaveRef = useRef(onSave)
  const isEqualRef = useRef(isEqual)
  const validateRef = useRef(validate)
  const enabledRef = useRef(enabled)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  valueRef.current = value
  onSaveRef.current = onSave
  isEqualRef.current = isEqual
  validateRef.current = validate
  enabledRef.current = enabled

  const setStatusSafe = useCallback((next: AutosaveStatus) => {
    if (mountedRef.current) setStatus(next)
  }, [])

  // Persist the latest value. If the value moved on mid-flight, persist again once the
  // in-flight request settles — so the final state always reaches the server.
  const run = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) return
    if (inFlightRef.current) return // a completion will re-check the latest value
    const snapshot = valueRef.current
    if (isEqualRef.current(snapshot, savedRef.current)) return
    if (validateRef.current && !validateRef.current(snapshot)) return

    inFlightRef.current = true
    setStatusSafe("saving")
    try {
      await onSaveRef.current(snapshot)
      savedRef.current = snapshot
      inFlightRef.current = false
      if (isEqualRef.current(valueRef.current, savedRef.current)) {
        setStatusSafe("saved")
      } else {
        await run() // newer edit arrived while saving — persist it too
      }
    } catch {
      inFlightRef.current = false
      setStatusSafe("error")
    }
  }, [setStatusSafe])

  // Debounced trigger: re-armed on every value change, cleared if the value is already saved.
  useEffect(() => {
    if (!enabled) return
    if (isEqualRef.current(value, savedRef.current)) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void run()
    }, delay)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, enabled, delay, run])

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    await run()
  }, [run])

  const reset = useCallback(
    (next: T) => {
      savedRef.current = next
      valueRef.current = next
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setStatusSafe("idle")
    },
    [setStatusSafe],
  )

  // On unmount, flush a pending edit so nothing is lost when the modal closes. The
  // equality guard inside `run` makes this a no-op when everything is already saved.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      void run()
    }
  }, [run])

  return { status, flush, reset }
}
