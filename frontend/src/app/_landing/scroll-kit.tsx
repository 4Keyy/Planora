"use client"

import { useRef, type ReactNode } from "react"
import {
  motion,
  useMotionTemplate,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"

/**
 * The scroll mechanics the landing page is built from.
 *
 * All of it is `transform` and `opacity`, which composite and therefore cannot produce a
 * layout shift — that is what makes this affordable against the route's 0.0000–0.0014 CLS
 * invariant, and it is worth restating because the repository's motion history is mostly
 * about transforms that DID cost something.
 *
 * What transforms cost is containing blocks. A transform on an ancestor silently
 * re-parents a `position: fixed` or `position: sticky` descendant — no error, no warning,
 * and on `/tasks` it once cost 16× the CLS. So nothing here may wrap the sticky nav, and
 * nothing here may wrap a non-portalled fixed control. `UndoBar` portals to
 * `document.body`, which is why the console is safe inside these.
 *
 * `MotionConfig reducedMotion="user"` does not reach a MotionValue we compute ourselves,
 * so every component below carries an explicit `useReducedMotion()` branch.
 */

/**
 * One element arriving on its own account.
 *
 * The difference between this and wrapping a whole block is the difference between a page
 * that appears and a page that assembles itself. Eight cards arriving together read as one
 * render; eight cards arriving 50ms apart read as a list being laid down.
 *
 * Capped at eight steps, per design-system § 9.9: past the eighth the delay outlasts the
 * reader's patience and the last item looks like it is loading rather than arriving.
 */
export function StaggerItem({
  children,
  index = 0,
  className,
}: {
  children: ReactNode
  index?: number
  className?: string
}) {
  const reduce = useReducedMotion() ?? false
  const delay = reduce ? 0 : Math.min(index, 8) * 0.05

  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO, delay }}
    >
      {children}
    </motion.div>
  )
}

/**
 * A band that travels sideways while the page scrolls down.
 *
 * This is the one moment on the page where the reading direction changes, and it is spent
 * on the list of things the product refuses to do — because that list is the page's most
 * unusual claim and deserves the page's most unusual movement.
 *
 * It is a `transform: translateX` on a row inside an `overflow-hidden` track, not a
 * scroll container: a real horizontal scroller would trap a trackpad and fight the page.
 * Under reduced motion the row simply wraps and stacks, so nothing is unreachable — the
 * content is never behind the animation.
 */
export function HorizontalBand({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion() ?? false

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })

  /**
   * Travel is a percentage of the row's OWN width, so it holds at any viewport without a
   * measurement pass — and a measurement pass is what would put layout back on the
   * critical path here.
   *
   * The number is sprung and the unit is templated on afterwards, in that order. Handing
   * `useSpring` a unit string does not work: it parses "8%" as the number 8 and the row
   * travels eight pixels instead of a third of its width, which is exactly the bug this
   * replaces — visible only by reading the computed transform, since eight pixels of
   * drift looks like a subtle effect rather than a broken one.
   */
  const pct = useSpring(useTransform(scrollYProgress, [0, 1], [8, -38]), {
    stiffness: 90,
    damping: 28,
    mass: 0.5,
  })
  const x = useMotionTemplate`${pct}%`

  if (reduce) {
    return (
      <div ref={ref} className={className}>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      </div>
    )
  }

  return (
    <div ref={ref} className={className}>
      {/* `clip` rather than `hidden`: `hidden` creates a scroll container, and this page
          has a sticky nav that references the same scroll root. */}
      <div className="[overflow-x:clip]">
        <motion.div style={{ x }} className="flex w-max gap-6">
          {children}
        </motion.div>
      </div>
    </div>
  )
}

/**
 * A pinned stage: the section holds still for one screen while its contents grow.
 *
 * `sticky` is on the inner stage and the transform is on the stage's CHILD wrapper —
 * never on an ancestor of the sticky node, which would re-parent it and break the pin
 * silently. That asymmetry is the whole trick, and the reason this is a component rather
 * than a pattern people re-type from memory.
 *
 * Under reduced motion the pin is dropped entirely rather than merely frozen: a
 * two-screen-tall track with a static child is a screen of blank scrolling, which is
 * worse than no effect at all.
 */
export function PinnedStage({
  children,
  /** Screens of scroll the pin lasts. Two gives one screen of travel. */
  screens = 2,
  /** How much the contents grow across the pin. Kept small; this is emphasis, not zoom. */
  to = 1.25,
  className,
}: {
  children: ReactNode
  screens?: number
  to?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion() ?? false

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end end'],
  })

  const rawScale = useTransform(scrollYProgress, [0, 1], [1, to])
  const scale = useSpring(rawScale, { stiffness: 110, damping: 30, mass: 0.4 })

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <div ref={ref} className={className} style={{ height: screens * 100 + "vh" }}>
      <div className="sticky top-0 flex h-screen items-center justify-center">
        <motion.div style={{ scale }}>{children}</motion.div>
      </div>
    </div>
  )
}
