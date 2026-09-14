"use client"

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowUp } from "lucide-react"
import { NumberRoll } from "@/components/ui/number-roll"
import { TWEEN_EXIT, TWEEN_UI } from "@/lib/animations"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * Someone else's change, offered rather than applied.
 *
 * A realtime list that inserts above the viewport moves every row under the
 * pointer. The click the user had already committed to lands on whatever slid
 * into that position — the wrong task completed, the wrong task deleted. The
 * same insert under a caret destroys the scroll anchor and the reading position
 * with it. That failure is worse than being a few seconds stale, so the arriving
 * change is held and the fact of it is offered as one button.
 *
 * The policy lives in `useDeferredUpdates`, not in this component, because the
 * decision is about the user's state and not about pixels: apply live only when
 * the list is already at the top AND the user is not mid-composition. At the top
 * an insert pushes content down without disturbing anything the pointer is aimed
 * at, and there is nothing above the fold to lose. Everywhere else, queue.
 *
 * The pill itself is drawn out of flow — a zero-height sticky strip with the
 * button overflowing it — so its appearance and its disappearance shift nothing.
 * A pill that reflowed the list to announce that the list must not reflow would
 * be the joke version of this component. The cost of that trick is that an
 * ancestor with `overflow-hidden` will clip it; the list column must not have one.
 */

export interface UpdatePillProps {
  count: number
  onShow: () => void
  /** "new task" / "update" — pluralised internally. */
  noun?: string
  className?: string
}

/** Naive English plural. The nouns this takes are ours, not user data. */
function pluralise(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`
}

/**
 * The one announcement per batch.
 *
 * `aria-live` fires on every mutation inside the region. Wrapping the count in
 * one would turn a burst of ten realtime ticks into ten interruptions, each
 * cutting off the last — a screen-reader denial of service driven by other
 * people's typing. Three things together prevent it:
 *
 *   1. The region holds no count. It says that updates exist; how many is on the
 *      button's `aria-label`, which is read when the user reaches the button and
 *      is never announced on change.
 *   2. The region is a SIBLING of the button, so the rolling digits — which
 *      mutate the DOM on every arrival — are outside it.
 *   3. The text is written once, by an effect on mount, into a region that
 *      rendered empty. Mounting a live region with its text already in place is
 *      the case browsers disagree about; mutating one that is already on the page
 *      is the case they all handle. It then never changes again, and the region
 *      is unmounted with the pill, so the next batch mounts a fresh one and earns
 *      exactly one more announcement.
 */
function BatchAnnouncement({ message }: { message: string }) {
  const first = useRef(message)
  const [text, setText] = useState("")

  useEffect(() => {
    setText(first.current)
  }, [])

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {text}
    </div>
  )
}

/**
 * Count-free and noun-free, and that is the whole point.
 *
 * The region's text must never change — see the note above — so it cannot name a
 * number, and pinning it to a hard-coded plural announced "New tasks available"
 * for a single arrival. Saying only that something arrived is true at every
 * count, and the number and the noun are already on the button's name, which is
 * read when the user reaches it rather than shouted when it changes.
 */
const ANNOUNCEMENT = "There is something new at the top of the list."

export function UpdatePill({ count, onShow, noun = "update", className }: UpdatePillProps) {
  /*
   * No early return on `count < 1`.
   *
   * Returning null here unmounted this component's whole subtree, which took the
   * AnimatePresence with it — so the exit variant below had never once run, and
   * the pill vanished on a frame instead of leaving. The container is a zero-height
   * sticky strip with nothing in it when the count is zero, which costs nothing and
   * keeps the presence boundary above the thing that animates.
   */
  const label = pluralise(noun, Math.max(count, 1))

  return (
    <div className={cn("sticky top-0 z-sticky flex h-0 items-start justify-center", className)}>
      {/* `items-start` is load-bearing: a stretch alignment would flatten the
          button to the strip's zero height. */}
      <AnimatePresence>
        {count > 0 && (
          <motion.button
            key="update-pill"
            type="button"
            onClick={() => {
              haptic("tap")
              onShow()
            }}
            // The count belongs here rather than in the live region: a name change
            // on a button is read on arrival, not shouted.
            aria-label={`Show ${count} ${label}`}
            className="mt-2 inline-flex min-h-touch min-w-touch items-center gap-2 rounded-full bg-accent px-4 text-body-sm font-semibold text-accent-ink shadow-md transition-colors duration-fast hover:bg-accent/90"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            // Leaving accelerates away rather than easing out, and it leaves the
            // way it came — the pill is an offer, and a declined offer should not
            // linger as long as it took to make.
            exit={{ opacity: 0, y: -8, transition: TWEEN_EXIT }}
            transition={TWEEN_UI}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
            <span aria-hidden="true" className="inline-flex items-center gap-1">
              <NumberRoll value={count} />
              {label}
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Mounted and unmounted with the batch, so each batch earns exactly one
          announcement and the next one gets a fresh region. */}
      {count > 0 && <BatchAnnouncement message={ANNOUNCEMENT} />}
    </div>
  )
}

// ─── The policy ─────────────────────────────────────────────────────────────

export interface DeferredUpdatesOptions<T = unknown> {
  /** True while the user is typing / a composer or dialog is open. */
  busy?: boolean
  /** Ref to the scroll container, or null for the window. */
  scrollRef?: RefObject<HTMLElement | null>
  /** px from the top that still counts as "at the top". Default 24. */
  threshold?: number
  /**
   * Where an applied change goes.
   *
   * The hook owns WHEN, never WHAT — the list itself lives in the caller's store.
   * Called with one item when it is applied live and with the whole queue, in
   * arrival order, when `show()` flushes, so the caller has a single sink and
   * cannot end up with two code paths that insert differently.
   */
  onApply?: (items: T[]) => void
}

/** A tap that lands 24px from the top was aimed at the top. */
const DEFAULT_THRESHOLD = 24

export function useDeferredUpdates<T>(options: DeferredUpdatesOptions<T> = {}) {
  const { busy = false, scrollRef, threshold = DEFAULT_THRESHOLD, onApply } = options
  const reduce = useReducedMotion() ?? false

  const [pending, setPending] = useState<T[]>([])
  const [atTop, setAtTop] = useState(true)

  /**
   * Everything `push` reads, it reads through a ref.
   *
   * A realtime subscription is registered once, in an effect with an empty
   * dependency list, and keeps whatever `push` it was handed. If that closure
   * read `busy` or `atTop` directly it would keep answering with the values from
   * the moment of subscription — the hook would decide "at the top, not busy"
   * forever, which is precisely the bug this component exists to prevent. So
   * `push` has a stable identity and the current values reach it by reference.
   */
  const busyRef = useRef(busy)
  const atTopRef = useRef(atTop)
  const pendingRef = useRef<T[]>(pending)
  const onApplyRef = useRef(onApply)

  useEffect(() => {
    busyRef.current = busy
    onApplyRef.current = onApply
  }, [busy, onApply])

  /**
   * Scroll position, as a boolean and nothing more.
   *
   * The listener runs on every scroll event, so it does the cheapest possible
   * thing: one `scrollTop` read and a `setState` that React discards unless the
   * boolean actually flipped. A scroll from the bottom of a long list to the top
   * therefore costs exactly one render, not one per frame.
   *
   * Binding in an effect is safe even when the container is rendered by the same
   * component: refs are attached during commit, before effects run.
   */
  useEffect(() => {
    const element = scrollRef?.current ?? null
    const target: EventTarget = element ?? window

    const read = () => {
      const offset = element ? element.scrollTop : window.scrollY
      const next = offset <= threshold
      atTopRef.current = next
      setAtTop(next)
    }

    read()
    target.addEventListener("scroll", read, { passive: true })
    return () => target.removeEventListener("scroll", read)
  }, [scrollRef, threshold])

  const push = useCallback((item: T) => {
    if (atTopRef.current && !busyRef.current) {
      onApplyRef.current?.([item])
      return
    }
    const next = [...pendingRef.current, item]
    pendingRef.current = next
    setPending(next)
  }, [])

  /**
   * The queue is mirrored in a ref rather than read inside a state updater.
   *
   * Calling `onApply` from inside `setPending(prev => …)` would apply every queued
   * change twice under StrictMode's double-invoked updaters, and a duplicated
   * realtime insert is indistinguishable from a real one.
   */
  const flush = useCallback((apply: boolean) => {
    const queued = pendingRef.current
    pendingRef.current = []
    if (queued.length > 0) {
      setPending([])
      if (apply) onApplyRef.current?.(queued)
    }
    return queued
  }, [])

  const scrollToTop = useCallback(() => {
    /**
     * `MotionConfig reducedMotion="user"` cannot reach native scrolling, so this
     * is one of the few places that still has to ask. A smooth programmatic jump
     * over a long list is exactly the vestibular trigger the setting exists for.
     */
    const behavior: ScrollBehavior = reduce ? "auto" : "smooth"
    const element = scrollRef?.current ?? null

    if (!element) {
      window.scrollTo({ top: 0, behavior })
      return
    }
    // Older WebViews expose `scrollTop` but not the options form of `scrollTo`.
    // Losing the smoothness is acceptable; losing the scroll is not.
    if (typeof element.scrollTo === "function") element.scrollTo({ top: 0, behavior })
    else element.scrollTop = 0
  }, [reduce, scrollRef])

  const show = useCallback(() => {
    flush(true)
    scrollToTop()
  }, [flush, scrollToTop])

  /**
   * Drop the queue without applying it. For the caller that has just refetched:
   * the queued items are already in the fresh response, and replaying them would
   * insert each one a second time.
   */
  const clear = useCallback(() => {
    flush(false)
  }, [flush])

  /**
   * Reaching the top does NOT drain the queue on its own. The user scrolling up
   * to re-read something has not asked for the list to change under them, and a
   * pill that vanished unpressed would leave them wondering what they missed.
   */
  return {
    push,
    pending,
    count: pending.length,
    show,
    clear,
    canApplyLive: atTop && !busy,
  }
}
