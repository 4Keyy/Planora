"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { AnimatePresence, useReducedMotion, type PanInfo } from "framer-motion"
import { AlertTriangle, Check, Info, Undo2, X } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { cn } from "@/lib/utils"
import { useToastStore, type ToastState, type ToastType } from "@/store/toast"
import { SPRING_LAYOUT, SPRING_STANDARD, DURATION_FAST, EASE_EXIT, EASE_OUT_EXPO } from "@/lib/animations"

/**
 * Every on-screen notice, in one stack at the bottom of the screen.
 *
 * Each is a drop of ink — the surface the navigation's active tab is drawn in — with its
 * kind said by a small mark on the left (a check, a warning, an "i", the undo arrow), its
 * words, at most one action, and a close. The stack is a deck: the newest at the front,
 * the two before it peeking out above, scaled back; pointing at it (or tabbing into it)
 * fans the deck out into a list and stops every clock until you leave. A notice can be
 * flicked away sideways. The same notice said twice counts ("×2") instead of stacking.
 *
 * At the bottom, centred, on every screen: where an undo has always been, in reach of a
 * thumb, and clear of the bar at the top. It rises above whatever is docked down there —
 * quick capture, the selection bar — through `--pl-dock-clearance`.
 */

/** Gap between notices when the deck is fanned out. */
const GAP = 8
/** How far each notice behind the front one peeks out above it. */
const PEEK = 10
/** How many show while the deck is closed: the front and two behind it. */
const DECK = 3
/** A flick that throws a notice this far, or this fast, dismisses it. */
const SWIPE_DISTANCE = 72
const SWIPE_VELOCITY = 500

const MARK: Record<ToastType | "undo", { icon: typeof Check; className: string }> = {
  success: { icon: Check, className: "bg-positive text-paper" },
  error: { icon: AlertTriangle, className: "bg-alert text-paper" },
  warning: { icon: AlertTriangle, className: "bg-warn text-paper" },
  info: { icon: Info, className: "bg-accent text-paper" },
  undo: { icon: Undo2, className: "bg-paper/15 text-paper" },
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)
  const paused = useToastStore((state) => state.paused)
  const pause = useToastStore((state) => state.pause)
  const resume = useToastStore((state) => state.resume)
  const removeToast = useToastStore((state) => state.removeToast)
  const reduce = useReducedMotion() ?? false

  const [heights, setHeights] = useState<Record<string, number>>({})
  const [pointerIn, setPointerIn] = useState(false)
  const [focusIn, setFocusIn] = useState(false)
  const [hidden, setHidden] = useState(false)
  const expanded = (pointerIn || focusIn) && toasts.length > 0

  // The clocks stop while the stack is being read, or while the tab is in the background:
  // a notice that expires unseen has said nothing.
  const reading = expanded || hidden
  useEffect(() => {
    if (reading) pause()
    else resume()
  }, [reading, pause, resume])

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden")
    sync()
    document.addEventListener("visibilitychange", sync)
    return () => document.removeEventListener("visibilitychange", sync)
  }, [])

  // Nothing left to read: the pointer may still be resting where the stack was.
  useEffect(() => {
    if (toasts.length === 0) setPointerIn(false)
  }, [toasts.length])

  const onHeight = useCallback((id: string, height: number) => {
    setHeights((current) => (current[id] === height ? current : { ...current, [id]: height }))
  }, [])

  // Newest first: index 0 is the front of the deck, at the bottom.
  const ordered = [...toasts].reverse()
  const front = ordered[0] ? heights[ordered[0].id] ?? 56 : 0
  const offsets: number[] = []
  let total = 0
  for (const [i, toast] of ordered.entries()) {
    offsets.push(total)
    total += (heights[toast.id] ?? 56) + (i < ordered.length - 1 ? GAP : 0)
  }
  const height = expanded ? total : front + Math.max(0, Math.min(ordered.length, DECK) - 1) * PEEK

  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex justify-center px-4"
      style={{
        paddingBottom: "max(calc(env(safe-area-inset-bottom) + 16px), calc(var(--pl-dock-clearance, 0px) + 12px))",
        transition: reduce ? undefined : "padding-bottom 320ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <ol
        className="pointer-events-auto relative w-full max-w-[420px]"
        style={{ height, transition: reduce ? undefined : "height 240ms cubic-bezier(0.4, 0, 0.2, 1)" }}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") setPointerIn(true) }}
        onPointerLeave={() => setPointerIn(false)}
        onFocus={() => setFocusIn(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false) }}
        onKeyDown={(e) => {
          // Escape takes the notice you are in away, and leaves the rest.
          if (e.key !== "Escape") return
          const item = (e.target as HTMLElement).closest<HTMLElement>("[data-toast-id]")
          if (!item?.dataset.toastId) return
          e.stopPropagation()
          removeToast(item.dataset.toastId)
        }}
      >
        <AnimatePresence initial={false}>
          {ordered.map((toast, index) => (
            <Notice
              key={toast.id}
              toast={toast}
              index={index}
              offset={offsets[index]}
              frontHeight={front}
              measured={heights[toast.id] !== undefined}
              expanded={expanded}
              paused={paused}
              reduce={reduce}
              onHeight={onHeight}
            />
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}

function Notice({
  toast,
  index,
  offset,
  frontHeight,
  measured,
  expanded,
  paused,
  reduce,
  onHeight,
}: {
  toast: ToastState
  index: number
  offset: number
  frontHeight: number
  measured: boolean
  expanded: boolean
  paused: boolean
  reduce: boolean
  onHeight: (id: string, height: number) => void
}) {
  const removeToast = useToastStore((state) => state.removeToast)
  const actOn = useToastStore((state) => state.actOn)
  const content = useRef<HTMLDivElement>(null)
  const [thrown, setThrown] = useState(0)

  useIsomorphicLayoutEffect(() => {
    const element = content.current
    if (!element) return
    const report = () => onHeight(toast.id, element.offsetHeight)
    report()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [toast.id, onHeight])

  const behind = !expanded && index > 0
  const gone = !expanded && index >= DECK
  const mark = MARK[toast.icon ?? toast.type]
  const Icon = mark.icon

  // Closed: every notice takes the front's height and peeks out above it, smaller the
  // further back; open: each at its own height, stacked upwards from the front.
  const height = behind && measured ? frontHeight : "auto"
  const target = {
    opacity: gone ? 0 : 1,
    y: expanded ? -offset : -index * PEEK,
    scale: reduce || expanded ? 1 : 1 - index * 0.05,
    height,
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) > SWIPE_DISTANCE || Math.abs(info.velocity.x) > SWIPE_VELOCITY) {
      // The direction is rendered first, so the exit throws it the way it was flicked.
      setThrown(Math.sign(info.offset.x || info.velocity.x))
      requestAnimationFrame(() => removeToast(toast.id))
    }
  }

  return (
    <motion.li
      data-toast-id={toast.id}
      // Errors interrupt (assertive); everything else is announced politely.
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      custom={thrown}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.94 }}
      animate={target}
      exit={reduce ? { opacity: 0 } : "leave"}
      variants={{
        leave: (direction: number) =>
          direction
            ? { opacity: 0, x: direction * 360, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }
            : { opacity: 0, y: 12, scale: 0.92, transition: { duration: DURATION_FAST, ease: EASE_EXIT } },
      }}
      transition={{
        y: SPRING_STANDARD,
        scale: SPRING_LAYOUT,
        height: SPRING_LAYOUT,
        opacity: { duration: DURATION_FAST, ease: EASE_OUT_EXPO },
      }}
      drag={reduce ? false : "x"}
      dragSnapToOrigin
      dragElastic={0.5}
      onDragEnd={onDragEnd}
      style={{ zIndex: 9 - index, transformOrigin: "50% 0%" }}
      className={cn(
        "absolute inset-x-0 bottom-0 overflow-hidden rounded-xl bg-ink text-paper shadow-xl",
        gone && "pointer-events-none",
        // The ones behind say nothing until the deck opens: only their edge shows.
        behind && "[&_[data-toast-body]]:opacity-0",
      )}
    >
      <div
        ref={content}
        data-toast-body=""
        className={cn(
          "flex gap-3 py-3 pl-3.5 pr-2 transition-opacity duration-fast",
          toast.description ? "items-start" : "items-center",
        )}
      >
        <span className={cn("relative mt-px flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full", mark.className)}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2.75} aria-hidden="true" />
          {toast.countdown && Number.isFinite(toast.remaining) ? (
            <Countdown key={toast.revision} ms={toast.total} paused={paused} reduce={reduce} />
          ) : null}
        </span>

        <div className="min-w-0 flex-1 py-0.5">
          <p className="flex items-center gap-2 text-body-sm font-semibold leading-5">
            <span className="min-w-0 break-words">{toast.title}</span>
            {toast.count > 1 ? (
              <span className="flex-shrink-0 rounded-full bg-paper/15 px-1.5 text-caption font-bold tabular-nums text-paper/80">
                ×{toast.count}
              </span>
            ) : null}
          </p>
          {toast.description ? (
            <p className="mt-0.5 break-words text-caption leading-[1.125rem] text-paper/70">{toast.description}</p>
          ) : null}
        </div>

        {toast.action ? (
          <button
            type="button"
            onClick={() => actOn(toast.id)}
            className="touch-target flex flex-shrink-0 items-center gap-1.5 self-center rounded-md px-2.5 py-1.5 text-body-sm font-bold text-paper transition-colors duration-fast hover:bg-paper/15 focus-visible:bg-paper/15"
          >
            {toast.icon === "undo" ? <Undo2 className="h-4 w-4" aria-hidden="true" /> : null}
            {toast.action.label}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => removeToast(toast.id)}
          aria-label="Dismiss notification"
          className="touch-target flex h-7 w-7 flex-shrink-0 items-center justify-center self-center rounded-full text-paper/55 transition-colors duration-fast hover:bg-paper/10 hover:text-paper"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </motion.li>
  )
}

/**
 * The time left to act, as a ring round the mark that drains — linear, because an eased
 * countdown misrepresents how much time is left. It stops with the clock while the stack
 * is being read, and restarts when the notice does.
 */
function Countdown({ ms, paused, reduce }: { ms: number; paused: boolean; reduce: boolean }) {
  if (reduce) return null
  const r = 13
  const circumference = 2 * Math.PI * r
  return (
    <svg aria-hidden="true" viewBox="0 0 30 30" className="pointer-events-none absolute -inset-[3px] h-[30px] w-[30px] -rotate-90">
      <circle cx="15" cy="15" r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2} />
      <circle
        cx="15"
        cy="15"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={circumference}
        className="toast-countdown"
        style={{ "--toast-ring": `${circumference}px`, animationDuration: `${ms}ms`, animationPlayState: paused ? "paused" : "running" } as CSSProperties}
      />
    </svg>
  )
}
