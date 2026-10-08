"use client"

import {
  createContext,
  createElement,
  forwardRef,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react"
import { tokens } from "@/lib/design-tokens"
import { cn } from "@/lib/utils"

/**
 * How a page arrives.
 *
 * Every signed-in page is a timeline that starts when it mounts — on a refresh, once the
 * session is restored; on a navigation, at once. Each block, card, line of text and chip
 * on it says *when* it arrives (`at`, ms after the start) and *what size of thing* it is (a
 * tier of `tokens.motion.entrance`); the motion itself is two compositor-only CSS
 * animations (`.enter` in `globals.css`). Nothing here runs per frame.
 *
 * - **A delay is decided once, at mount.** Re-rendering never restarts or shifts an entrance.
 * - **Late arrivals are not made to wait.** Content that comes with its data, after its
 *   moment on the timeline has passed, starts at once and keeps only its own stagger — a
 *   slow response delays the cards by exactly the response, never by the choreography.
 * - **Outside a timeline nothing happens.** A component used on the landing page or in a
 *   test renders exactly as before; only the (app) template starts a timeline.
 * - **Reduced motion** is `globals.css`: no delays, no travel, everything simply there.
 */

export type EntranceTier = keyof typeof tokens.motion.entrance

/** The rhythm of an arrival: the gap between one block of a page and the next. */
export const BEAT = 70

/** Siblings stagger for this many steps at most; the rest arrive with the last of them. */
const MAX_STAGGER_STEPS = 8

interface Timeline {
  /** `performance.now()` of this timeline's 0ms, or null while it waits to be revealed. */
  origin: number | null
}

const TimelineContext = createContext<Timeline | null>(null)

const clock = () => (typeof performance === "undefined" ? 0 : performance.now())

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/** Starts a page's timeline. The (app) template renders one for every page it shows. */
export function EntranceTimeline({ children }: { children: ReactNode }) {
  const [timeline] = useState<Timeline>(() => ({ origin: clock() }))
  return <TimelineContext.Provider value={timeline}>{children}</TimelineContext.Provider>
}

/**
 * Shifts the timeline by `at` ms for everything inside, so a reusable block — a page
 * header, a row of stats — places its own parts at 0, 60, 120… and the page decides when
 * the block as a whole arrives.
 */
export function EntranceGroup({ at, children }: { at: number; children: ReactNode }) {
  const parent = useContext(TimelineContext)
  const origin = parent?.origin ?? null
  const timeline = useMemo<Timeline>(() => ({ origin: origin === null ? null : origin + at }), [origin, at])
  if (!parent) return <>{children}</>
  return <TimelineContext.Provider value={timeline}>{children}</TimelineContext.Provider>
}

const TIER_STYLE = Object.fromEntries(
  Object.entries(tokens.motion.entrance).map(([tier, t]) => [
    tier,
    {
      "--enter-y": `${t.y}px`,
      "--enter-scale": String(t.scale),
      "--enter-duration": `${t.duration}ms`,
      "--enter-fade": `${t.fade}ms`,
    },
  ]),
) as unknown as Record<EntranceTier, CSSProperties>

export interface EnterOptions {
  /** When it arrives, in ms after the start of its timeline, before its stagger. */
  at?: number
  /** Its place among the siblings arriving together. */
  index?: number
  /** `grow` for a bar rising out of its baseline instead of travelling up. */
  motion?: "rise" | "grow"
  /**
   * False while what it shows is still on its way — a count that would read 0 for a moment,
   * a chart with no data. It keeps its place in the layout, invisible, and arrives once this
   * turns true (on its moment, or at once if that has passed), with its real value.
   */
  ready?: boolean
}

export interface Entrance {
  className?: string
  style?: CSSProperties
}

const NONE: Entrance = {}
const PENDING: Entrance = { className: "enter-pending" }

/** The delay an element mounting now waits, given where its timeline started. */
export function entranceDelay(origin: number, tier: EntranceTier, at: number, index: number, now: number): number {
  // A moment already passed starts now; the stagger is kept, so a list that arrives late
  // still pours in rather than landing all at once.
  const base = Math.max(0, origin + at - now)
  const step = tokens.motion.entrance[tier].stagger * Math.min(Math.max(index, 0), MAX_STAGGER_STEPS)
  return Math.round(base + step)
}

/**
 * The class and inline style that make an element arrive. Spread them onto the element
 * itself, merged with its own — no wrapper, so a grid or a flex row keeps its children.
 * Outside a timeline it returns nothing.
 */
export function useEnter(tier: EntranceTier, options: EnterOptions = {}): Entrance {
  return useEntranceOn(useContext(TimelineContext), tier, options)
}

function useEntranceOn(
  timeline: Timeline | null,
  tier: EntranceTier,
  { at = 0, index = 0, motion = "rise", ready = true }: EnterOptions,
): Entrance {
  const frozen = useRef<{ origin: number; style: CSSProperties } | null>(null)
  if (!timeline) return NONE
  if (timeline.origin === null || (!ready && frozen.current === null)) return PENDING
  if (frozen.current?.origin !== timeline.origin) {
    frozen.current = {
      origin: timeline.origin,
      style: {
        ...TIER_STYLE[tier],
        "--enter-delay": `${entranceDelay(timeline.origin, tier, at, index, clock())}ms`,
      } as CSSProperties,
    }
  }
  return { className: motion === "grow" ? "enter-grow" : "enter", style: frozen.current.style }
}

/**
 * The class and style that make an element's children arrive one after another, each a
 * `tier` thing, from `at` (`.enter-each` in `globals.css`). For a container whose children
 * cannot be wrapped — a flex row of pills, a strip of tiles, a list — and whose children
 * are elements, not bare text. A child added later waits out the same delay from its own
 * arrival, so it is meant for children that come with the container.
 */
export function useEnterEach(tier: EntranceTier, { at = 0, ready = true }: { at?: number; ready?: boolean } = {}): Entrance {
  const timeline = useContext(TimelineContext)
  const frozen = useRef<{ origin: number; style: CSSProperties } | null>(null)
  if (!timeline) return NONE
  if (timeline.origin === null || (!ready && frozen.current === null)) return PENDING
  if (frozen.current?.origin !== timeline.origin) {
    frozen.current = {
      origin: timeline.origin,
      style: {
        ...TIER_STYLE[tier],
        "--enter-delay": `${entranceDelay(timeline.origin, tier, at, 0, clock())}ms`,
        "--enter-stagger": `${tokens.motion.entrance[tier].stagger}ms`,
      } as CSSProperties,
    }
  }
  return { className: "enter-each", style: frozen.current.style }
}

/** Whether a page timeline runs here — for components that otherwise animate their own arrival. */
export function useInEntrance(): boolean {
  return useContext(TimelineContext) !== null
}

type EnterProps = HTMLAttributes<HTMLElement> & EnterOptions & {
  tier: EntranceTier
  /** The element to render; a `div` by default. */
  as?: keyof HTMLElementTagNameMap
}

/** Merges an entrance into an element's own class and style. */
function withEntrance(entrance: Entrance, className: string | undefined, style: CSSProperties | undefined) {
  return {
    className: cn(entrance.className, className) || undefined,
    style: entrance.style || style ? { ...entrance.style, ...style } : undefined,
  }
}

/** `useEnter` as an element, for list items and the places a hook cannot go. */
export const Enter = forwardRef<HTMLElement, EnterProps>(function Enter(
  { tier, at, index, motion, ready, as = "div", className, style, ...rest },
  ref,
) {
  const entrance = useEnter(tier, { at, index, motion, ready })
  return createElement(as, { ...rest, ref, ...withEntrance(entrance, className, style) })
})

type EnterEachProps = HTMLAttributes<HTMLElement> & {
  tier: EntranceTier
  at?: number
  ready?: boolean
  as?: keyof HTMLElementTagNameMap
}

/**
 * `useEnterEach` as an element: a list whose items arrive one after another, timed from
 * when the list itself appears — so a list that comes with its data, long after the
 * page, still pours in rather than landing all at once.
 */
export const EnterEach = forwardRef<HTMLElement, EnterEachProps>(function EnterEach(
  { tier, at, ready, as = "div", className, style, ...rest },
  ref,
) {
  const entrance = useEnterEach(tier, { at, ready })
  return createElement(as, { ...rest, ref, ...withEntrance(entrance, className, style) })
})

/**
 * Arrives when it scrolls into view — the parts of a long page below its first screen.
 * In view when the page appears, it arrives on the page's timeline at `at`; further down
 * it waits invisible, and its own timeline starts the moment it is 40px into the viewport,
 * so the reader watches it arrive instead of finding it already there.
 *
 * Everything inside places itself on that timeline. With a `tier`, the element itself
 * arrives too, at its 0 (plus `index` steps, for siblings revealed together).
 */
export const EnterInView = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & {
  at?: number
  as?: keyof HTMLElementTagNameMap
  tier?: EntranceTier
  index?: number
  children: ReactNode
}>(function EnterInView({ at = 0, as = "div", tier, index, className, style, children, ...rest }, forwarded) {
  const parent = useContext(TimelineContext)
  const parentOrigin = parent?.origin ?? null
  const local = useRef<HTMLElement | null>(null)
  const [origin, setOrigin] = useState<number | null>(null)
  const timeline = useMemo<Timeline>(() => ({ origin }), [origin])
  // The stagger moves the element's whole timeline, not just the element: a card that
  // arrives a step after its neighbour brings its contents a step later too.
  const shift = tier ? tokens.motion.entrance[tier].stagger * Math.min(Math.max(index ?? 0, 0), MAX_STAGGER_STEPS) : 0
  const self = useEntranceOn(parent && tier ? timeline : null, tier ?? "panel", {})

  useIsomorphicLayoutEffect(() => {
    if (parentOrigin === null || origin !== null) return
    const node = local.current
    if (!node) return
    const box = node.getBoundingClientRect()
    if (box.top < window.innerHeight && box.bottom > 0) {
      setOrigin(parentOrigin + at + shift)
      return
    }
    if (typeof IntersectionObserver === "undefined") {
      setOrigin(clock() + shift)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        setOrigin(clock() + shift)
      },
      { rootMargin: "0px 0px -40px 0px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [parentOrigin, at, shift, origin])

  const ref = (node: HTMLElement | null) => {
    local.current = node
    if (typeof forwarded === "function") forwarded(node)
    else if (forwarded) forwarded.current = node
  }

  const element = createElement(as, { ...rest, ref, ...withEntrance(self, className, style) }, children)
  if (!parent) return element
  return <TimelineContext.Provider value={timeline}>{element}</TimelineContext.Provider>
})

/**
 * An ancestor animates this element's arrival, so it must not animate its own: a card in
 * a grid that rises it in would otherwise rise twice, and two rises stacked read as a jump
 * rather than a settle.
 */
const ArrivalContext = createContext(false)

export function ArrivalHandled({ children }: { children: ReactNode }) {
  return <ArrivalContext.Provider value>{children}</ArrivalContext.Provider>
}

export function useArrivalHandled(): boolean {
  return useContext(ArrivalContext)
}

/** How long a skeleton waits before it starts to show — `.skeleton-defer`'s delay in `globals.css`. */
const SKELETON_DEFER_MS = 280

/** How long a skeleton takes to fade out from under the content that replaced it. */
const SKELETON_LEAVE_MS = tokens.motion.duration.slow

/**
 * A placeholder for content on its way, without the two flashes placeholders cause.
 *
 * It is not seen at all unless the wait is long enough to notice (`.skeleton-defer`): a
 * fast response replaces an invisible skeleton, so a quick load never flashes grey boxes.
 * And when the content arrives the skeleton is not cut away — it steps out of the flow
 * behind the content, still the same element, and fades from wherever it had got to while
 * the content's own entrance plays over it. Cutting it left a frame of empty page between
 * the last grey box and the first card. A skeleton that never began to show has nothing
 * to fade, and simply goes.
 */
export function SkeletonSwap({
  loading,
  skeleton,
  children,
  className,
}: {
  loading: boolean
  skeleton: ReactNode
  children: ReactNode
  className?: string
}) {
  const [phase, setPhase] = useState(() => ({ loading, leaving: false, since: clock() }))
  if (phase.loading !== loading) {
    const now = clock()
    const wasShowing = phase.loading && now - phase.since >= SKELETON_DEFER_MS
    setPhase({ loading, leaving: wasShowing && !loading, since: now })
  }

  useEffect(() => {
    if (!phase.leaving) return
    const timer = window.setTimeout(() => setPhase((p) => ({ ...p, leaving: false })), SKELETON_LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [phase.leaving])

  const showSkeleton = loading || phase.leaving
  return (
    <div className={cn("relative", className)}>
      {showSkeleton ? (
        <div
          key="skeleton"
          aria-hidden="true"
          className={loading ? "skeleton-defer" : "skeleton-leave pointer-events-none absolute inset-x-0 top-0"}
        >
          {skeleton}
        </div>
      ) : null}
      {loading ? null : <div className="relative">{children}</div>}
    </div>
  )
}
