"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion"
import { ArrowRight, type LucideIcon } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { InkCheck } from "@/components/ui/ink-check"
import { FIELD_LABEL_CLASS } from "@/components/ui/field-label"
import { DURATION_DELIBERATE, EASE_OUT_EXPO, SPRING_LAYOUT, SPRING_RESPONSIVE } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * The page that stands in when another cannot be shown — a 404, a screen that crashed, a
 * lost connection, a task that is not there.
 *
 * It is built from the product's own pieces rather than an apology in grey: on the left an
 * illustration drawn in the completion circle's ink, the sentence that says what happened,
 * and the evidence (the address, a reference); on the right, where to go next, as a small
 * pile of task cards — because in Planora the way forward is always a task. Each card can
 * be ticked like one: its circle inks, the check draws, and you are on your way. The pile
 * leans towards the pointer and its cards can be picked up and tossed back.
 *
 * Every motion here is decoration on top of plain links and buttons in reading order: the
 * keyboard, a screen reader and reduced motion get the same destinations, with nothing to
 * wait for.
 */

export interface Destination {
  label: string
  hint: string
  icon: LucideIcon
  /** A page to go to. */
  href?: string
  /** Or something to do — try again, go back. */
  onSelect?: () => void
}

/** How long a ticked card shows its check before the page moves on. */
const TICK_MS = 420

export function ErrorScene({
  variant = "page",
  eyebrow,
  title,
  description,
  art,
  detail,
  destinations,
}: {
  /** `page` fills the window (a 404, a crash before any frame); `inline` sits inside a page. */
  variant?: "page" | "inline"
  eyebrow: string
  title: string
  description: ReactNode
  art: ReactNode
  /** The evidence under the sentence: the address that was asked for, a reference to quote. */
  detail?: ReactNode
  destinations: Destination[]
}) {
  const reduce = useReducedMotion() ?? false
  const Root = variant === "page" ? "main" : "section"

  return (
    <Root
      id={variant === "page" ? "main" : undefined}
      aria-labelledby="error-title"
      className={cn(
        "relative mx-auto flex w-full max-w-5xl items-center px-4 sm:px-6",
        variant === "page" ? "min-h-[100svh] py-16" : "py-10 sm:py-14",
      )}
    >
      <div className="grid w-full items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION_DELIBERATE, ease: EASE_OUT_EXPO }}
          className="min-w-0"
        >
          <div className="mb-8">{art}</div>
          <p className={FIELD_LABEL_CLASS}>{eyebrow}</p>
          <h1 id="error-title" className="mt-2 text-title font-bold tracking-tight text-ink sm:text-display-sm">
            {title}
          </h1>
          <div className="mt-3 max-w-prose text-body text-ink-muted">{description}</div>
          {detail ? <div className="mt-5">{detail}</div> : null}
        </motion.div>

        <DestinationPile destinations={destinations} />
      </div>
    </Root>
  )
}

/** The address that was asked for, set like code: the evidence, not a sentence about it. */
export function PathChip({ path }: { path: string }) {
  return (
    <p className="inline-flex max-w-full items-center gap-2 rounded-sm border border-line bg-paper-sunken px-2.5 py-1 font-mono text-caption text-ink-muted">
      <span className="flex-shrink-0 text-ink-subtle">Asked for</span>
      <span className="truncate text-ink">{path}</span>
    </p>
  )
}

/** A reference a person can quote in a report, with a button that copies it. */
export function ReferenceChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <p className="inline-flex max-w-full items-center gap-2 text-caption text-ink-muted">
      <span>Reference</span>
      <code className="truncate rounded-sm border border-line bg-paper-sunken px-1.5 py-0.5 font-mono text-ink">{id}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(id).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
        }}
        className="touch-target rounded-sm px-1.5 py-0.5 font-semibold text-ink underline-offset-2 hover:underline"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </p>
  )
}

/**
 * Where to go next, as a pile of task cards. Fanned out a little on a wide screen and
 * leaning towards the pointer; a plain column on a phone, and under reduced motion.
 */
function DestinationPile({ destinations }: { destinations: Destination[] }) {
  const reduce = useReducedMotion() ?? false
  const pile = useRef<HTMLDivElement>(null)
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const tiltX = useSpring(useTransform(pointerY, [-1, 1], [4, -4]), SPRING_LAYOUT)
  const tiltY = useSpring(useTransform(pointerX, [-1, 1], [-5, 5]), SPRING_LAYOUT)
  const [fanned, setFanned] = useState(false)

  useEffect(() => {
    if (reduce || typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(min-width: 640px) and (pointer: fine)")
    const sync = () => setFanned(query.matches)
    sync()
    query.addEventListener("change", sync)
    return () => query.removeEventListener("change", sync)
  }, [reduce])

  return (
    <div style={{ perspective: fanned ? 900 : undefined }}>
      <motion.div
        ref={pile}
        style={fanned ? { rotateX: tiltX, rotateY: tiltY, transformStyle: "preserve-3d" } : undefined}
        onPointerMove={(e: React.PointerEvent<HTMLDivElement>) => {
          if (!fanned || !pile.current) return
          const box = pile.current.getBoundingClientRect()
          pointerX.set(((e.clientX - box.left) / box.width) * 2 - 1)
          pointerY.set(((e.clientY - box.top) / box.height) * 2 - 1)
        }}
        onPointerLeave={() => {
          pointerX.set(0)
          pointerY.set(0)
        }}
      >
        <ol aria-label="Where to go instead" className="relative grid gap-3 sm:gap-4">
        {destinations.map((destination, index) => (
          <DestinationCard
            key={destination.label}
            destination={destination}
            index={index}
            count={destinations.length}
            fanned={fanned}
            reduce={reduce}
          />
        ))}
        </ol>
      </motion.div>
    </div>
  )
}

function DestinationCard({
  destination,
  index,
  count,
  fanned,
  reduce,
}: {
  destination: Destination
  index: number
  count: number
  fanned: boolean
  reduce: boolean
}) {
  const [ticked, setTicked] = useState(false)
  const dragged = useRef(false)
  const anchor = useRef<HTMLAnchorElement>(null)
  // The link's own click, let through once the check has drawn: `Link` then navigates
  // as it always does, with prefetching and history intact.
  const passThrough = useRef(false)
  const Icon = destination.icon
  // A loose pile: each card turned a little, alternately nudged off the column.
  const angle = fanned ? (index - (count - 1) / 2) * 2.4 + (index % 2 ? 0.8 : -0.6) : 0
  const nudge = fanned ? (index % 2 ? 14 : -6) : 0

  const follow = useCallback(() => {
    if (destination.href) {
      passThrough.current = true
      anchor.current?.click()
    } else {
      destination.onSelect?.()
    }
  }, [destination])

  const tick = (event: React.MouseEvent) => {
    if (passThrough.current) {
      passThrough.current = false
      return
    }
    if (dragged.current) {
      dragged.current = false
      event.preventDefault()
      return
    }
    // Open in a new tab, as any link: no ceremony.
    if (destination.href && (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)) return
    event.preventDefault()
    if (ticked) return
    setTicked(true)
    window.setTimeout(() => {
      follow()
      setTicked(false)
    }, reduce ? 0 : TICK_MS)
  }

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-fast",
          ticked ? "border-transparent" : "border-line-strong group-hover/dest:border-ink",
        )}
      >
        {ticked ? <InkCheck size={18} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold tracking-tight text-ink sm:text-title-sm">{destination.label}</span>
        <span className="mt-0.5 block text-caption text-ink-muted">{destination.hint}</span>
      </span>
      <span
        aria-hidden="true"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-paper-sunken text-ink-subtle transition-[color,background-color,transform] duration-fast group-hover/dest:translate-x-0.5 group-hover/dest:bg-ink group-hover/dest:text-paper"
      >
        {ticked ? <ArrowRight className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
    </>
  )

  const className = cn(
    "group/dest flex w-full items-center gap-4 rounded-lg border border-line bg-paper p-4 text-left shadow-sm sm:p-5",
    "transition-[box-shadow,border-color] duration-base hover:border-line-strong hover:shadow-lg",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
    ticked && "cursor-default",
  )

  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 22, rotate: 0 }}
      animate={{ opacity: 1, y: 0, rotate: angle, x: nudge }}
      transition={{ ...SPRING_RESPONSIVE, opacity: { duration: 0.3 }, delay: reduce ? 0 : 0.12 + index * 0.07 }}
      whileHover={fanned ? { rotate: 0, y: -4, scale: 1.015, zIndex: 2 } : undefined}
      drag={fanned}
      dragSnapToOrigin
      dragElastic={0.35}
      whileDrag={{ scale: 1.04, rotate: 0, zIndex: 3, cursor: "grabbing" }}
      onDragStart={() => { dragged.current = true }}
      className="relative"
    >
      {destination.href ? (
        <Link ref={anchor} href={destination.href} onClick={tick} className={className} draggable={false}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={tick} className={className}>
          {body}
        </button>
      )}
    </motion.li>
  )
}

/**
 * "404" with the 0 drawn as the completion circle — the one shape every task in the
 * product is waiting to have ticked. Ticking it inks it, draws the check, and takes you
 * to the first way out.
 */
export function MissingNumeral({ label, onTick }: { label: string; onTick: () => void }) {
  const reduce = useReducedMotion() ?? false
  const [ticked, setTicked] = useState(false)
  return (
    <div
      className="flex select-none items-center font-bold leading-none tracking-tight text-ink"
      style={{ fontSize: "clamp(5rem, 15vw, 8.5rem)" }}
    >
      <span aria-hidden="true">4</span>
      <motion.button
        type="button"
        aria-label={label}
        onClick={() => {
          if (ticked) return
          setTicked(true)
          window.setTimeout(onTick, reduce ? 0 : TICK_MS + 80)
        }}
        whileHover={reduce ? undefined : { scale: 1.04 }}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        transition={SPRING_RESPONSIVE}
        className="group/zero relative mx-[0.06em] inline-flex h-[0.72em] w-[0.72em] items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
          <motion.circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="15"
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: EASE_OUT_EXPO, delay: 0.15 }}
          />
        </svg>
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-ink"
          initial={false}
          animate={{ scale: ticked ? 1 : 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
        />
        <svg viewBox="0 0 24 24" className="relative h-[46%] w-[46%]" fill="none" aria-hidden="true">
          <motion.path
            d="M4.5 12.5 L9.5 17.5 L19.5 7"
            stroke={ticked ? "var(--pl-paper)" : "currentColor"}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: ticked ? 1 : 0, opacity: ticked ? 1 : 0 }}
            transition={{ duration: 0.24, ease: EASE_OUT_EXPO, delay: ticked ? 0.12 : 0 }}
            className="group-hover/zero:opacity-25"
          />
        </svg>
      </motion.button>
      <span aria-hidden="true">4</span>
    </div>
  )
}

/**
 * A circle that will not close: the completion ring with a gap in it, turning slowly, an
 * exclamation where the check would go. Pointing at it, the gap narrows, as if trying.
 */
export function SnagMark() {
  const reduce = useReducedMotion() ?? false
  const [trying, setTrying] = useState(false)
  return (
    <div
      className="relative h-24 w-24 sm:h-28 sm:w-28"
      onPointerEnter={() => setTrying(true)}
      onPointerLeave={() => setTrying(false)}
      aria-hidden="true"
    >
      <motion.svg
        viewBox="0 0 100 100"
        className="h-full w-full text-ink"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={reduce ? undefined : { duration: 14, ease: "linear", repeat: Infinity }}
      >
        <motion.circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: trying ? 0.9 : 0.76 }}
          transition={{ ...SPRING_RESPONSIVE, pathLength: { duration: 0.6, ease: EASE_OUT_EXPO } }}
        />
      </motion.svg>
      <span className="absolute inset-0 flex items-center justify-center text-[2.5rem] font-bold leading-none text-alert sm:text-[2.75rem]">!</span>
    </div>
  )
}

/** A ring looking for a connection: an arc that circles, and closes the moment one is back. */
export function OfflineMark({ online }: { online: boolean }) {
  const reduce = useReducedMotion() ?? false
  return (
    <div className="relative h-24 w-24 sm:h-28 sm:w-28" aria-hidden="true">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-line">
        <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="10" strokeDasharray="4 14" strokeLinecap="round" />
      </svg>
      <motion.svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full text-ink"
        animate={reduce || online ? { rotate: 0 } : { rotate: 360 }}
        transition={reduce || online ? { duration: 0 } : { duration: 1.6, ease: "linear", repeat: Infinity }}
      >
        <motion.circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: online ? 1 : 0.22 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
          style={{ rotate: -90, transformOrigin: "50% 50%" }}
        />
      </motion.svg>
    </div>
  )
}

/**
 * A task card that is not there: its outline drawn in dashes, an empty circle, the lines
 * where a title and its chips would be. It shrugs when pointed at.
 */
export function GhostCard() {
  const reduce = useReducedMotion() ?? false
  return (
    <motion.div
      aria-hidden="true"
      initial={reduce ? false : { rotate: -3 }}
      animate={{ rotate: -3 }}
      whileHover={reduce ? undefined : { rotate: [-3, 2, -1.5, -3], transition: { duration: 0.6 } }}
      className="flex w-60 max-w-full items-center gap-4 rounded-lg border-2 border-dashed border-line-strong bg-paper/60 p-5"
    >
      <span className="h-8 w-8 flex-shrink-0 rounded-full border-2 border-dashed border-line-strong" />
      <span className="flex-1 space-y-2.5">
        <span className="block h-3 w-4/5 rounded-full bg-line" />
        <span className="flex gap-2">
          <span className="block h-3 w-12 rounded-full bg-line" />
          <span className="block h-3 w-8 rounded-full bg-line" />
        </span>
      </span>
    </motion.div>
  )
}
