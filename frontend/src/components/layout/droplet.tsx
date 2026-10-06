"use client"

import { useEffect, useRef, useState, type FocusEventHandler, type PointerEventHandler, type ReactNode } from "react"
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion"
import { DROPLET_OPEN, DROPLET_START, trackDropletScroll, type DropletScroll, type DropletTrack } from "@/lib/droplet"
import { SPRING_STANDARD } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * The droplet: the floating capsule every bar in Planora is drawn as — the app's, and the
 * landing page's.
 *
 * It owns what makes a bar a droplet and nothing about what is inside it:
 *
 * - **It floats.** A `fixed` capsule centred at the top, `pointer-events` only on the
 *   capsule so the page beside it stays clickable. It takes no room; the page holds its
 *   own room with `--bar-clearance` (globals.css).
 * - **Its glass is a layer of its own** — fill, hairline border, shadow and blur — never the
 *   capsule itself. `backdrop-filter` makes an element the containing block of its fixed
 *   descendants, and a menu opening out of the droplet must not be trapped in it.
 * - **Its width is liquid.** Content changes spring the capsule to its new size with
 *   framer-motion's `layout` — a scale corrected for the radius, so transform only — and the
 *   glass follows. Callers mark their children `layout="position"` so text never stretches,
 *   and change the content in ONE commit: framer measures a layout change only when a
 *   `layout` component re-renders, and a child that `AnimatePresence` removes after its exit
 *   re-renders none of them — the capsule kept springing towards a box that no longer
 *   existed and snapped ~70px narrower at the end. A leaving child goes `sr-only` at once or
 *   leaves through `mode="popLayout"`.
 * - **It gets out of the way on a phone.** `hidden` slides this whole frame up by its own
 *   height (safe area, margin, capsule) plus the 2rem its shadow reaches below it. A CSS
 *   transition on the plain wrapper, never motion on the capsule: the capsule's transform
 *   belongs to the layout projection, and opacity on any ancestor of the glass makes that
 *   ancestor the glass's Backdrop Root and switches the blur off for the whole slide.
 *   Leaving is `ease-standard` — no jump at the start, no acceleration at the end — and
 *   arriving `ease-emphasized`, 320ms each way (`duration-slow`).
 * - Under reduced motion every change is instant.
 */

/**
 * Whether focus arrived from the keyboard — the only focus that should hold a droplet whole.
 * A click focuses the link or button in most desktop browsers, and a bar outlives the
 * navigation it starts, so treating pointer focus as "reaching for the bar" pinned it whole on
 * every page after the first click. `:focus-visible` is the browser's own answer; an engine
 * that cannot parse the selector gets `true`, so the bar errs towards staying whole.
 */
export function isKeyboardFocus(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  try {
    return target.matches(":focus-visible")
  } catch {
    return true
  }
}

/** Below the `sm` breakpoint — where the bar's contents move into a menu. */
export function useIsPhone() {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 639.98px)")
    if (!query) return
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener?.("change", update)
    return () => query.removeEventListener?.("change", update)
  }, [])
  return phone
}

/** The droplet's answer to the scroll; renders only when that answer changes. */
export function useDropletScroll(): DropletScroll {
  const [scroll, setScroll] = useState(DROPLET_OPEN)
  const track = useRef<DropletTrack>(DROPLET_START)
  const { scrollY } = useScroll()
  useMotionValueEvent(scrollY, "change", (y) => {
    const next = trackDropletScroll(track.current, y)
    if (next.state !== track.current.state) setScroll(next.state)
    track.current = next
  })
  return scroll
}

export function DropletFrame({
  as = "header",
  label,
  hidden = false,
  className,
  children,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
}: {
  /** `header` for the app's bar (it holds a `nav`), `nav` for a bar that is only links. */
  as?: "header" | "nav"
  /** The landmark's name, for a `nav`. */
  label?: string
  hidden?: boolean
  className?: string
  children: ReactNode
  onPointerEnter?: PointerEventHandler<HTMLElement>
  onPointerLeave?: PointerEventHandler<HTMLElement>
  onFocus?: FocusEventHandler<HTMLElement>
  onBlur?: FocusEventHandler<HTMLElement>
}) {
  const reduce = useReducedMotion() ?? false
  const morph = reduce ? { duration: 0 } : SPRING_STANDARD
  const Capsule = as === "nav" ? motion.nav : motion.header

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-sticky flex justify-center px-3 pt-safe",
        // The phone slide. framer never writes to this div, so nothing re-eases the transition.
        // Without the translate class its transform is `none`: a resting bar is never the
        // containing block of its menus.
        "transition-transform duration-slow motion-reduce:transition-none",
        hidden ? "-translate-y-[calc(100%+2rem)] ease-standard" : "ease-emphasized",
      )}
    >
      <Capsule
        aria-label={label}
        layout
        transition={{ layout: morph }}
        style={{ borderRadius: 9999 }}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn(
          // `isolate`: the glass sits at z -1 inside the capsule's own stacking context, so it
          // is always behind the capsule's contents — positioned or not — and never behind the page.
          "pointer-events-auto relative isolate mt-3 flex h-14 w-full max-w-md items-center gap-1 px-1.5 sm:mt-4 sm:w-auto sm:max-w-none",
          className,
        )}
      >
        {/* The glass: its own layer, so the blur never becomes the menus' containing block. */}
        <motion.span
          layout
          transition={{ layout: morph }}
          aria-hidden="true"
          style={{ borderRadius: 9999 }}
          className="absolute inset-0 -z-10 border border-line/80 bg-paper/85 shadow-lg backdrop-blur-xl"
        />
        {children}
      </Capsule>
    </div>
  )
}
