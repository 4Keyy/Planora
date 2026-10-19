"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import { animate, useMotionValue, useSpring, useTransform, type MotionValue } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { EASE_EXIT } from "@/lib/animations"
import { cn } from "@/lib/utils"

/**
 * The motion every audience picture shares — the landing page's first block and the audience
 * map in the app: the line from you to a person you let in, and the slow drift of the people
 * who are not in yet.
 *
 * Both are driven by motion values, never by React state, so a whole map of friends breathing
 * and every line bending with them costs no renders at all.
 */

/* ------------------------------------------------------------------------------------------ */
/*  The clock                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/**
 * One clock for a whole picture, in ms, ticking only while `running`: the picture is on screen
 * and motion is allowed. A stopped clock holds its time, so the drift resumes where it paused
 * instead of jumping.
 */
export function useClock(running: boolean): MotionValue<number> {
  const time = useMotionValue(0)
  useEffect(() => {
    if (!running) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      // A tab in the background delivers one huge step on return; cap it.
      time.set(time.get() + Math.min(64, now - last))
      last = now
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, time])
  return time
}

/**
 * Whether the element is on screen, for pausing the clock of a picture nobody can see. Where
 * IntersectionObserver is missing it answers no: idle motion is decoration, and never worth a
 * clock that cannot tell whether anyone is looking (every supported browser has the observer;
 * a test DOM does not).
 */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [onScreen, setOnScreen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? false))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return onScreen
}

/* ------------------------------------------------------------------------------------------ */
/*  The drift                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** How far a seat wanders from its place, in px, and how slowly (ms per sway, before the seed). */
const DRIFT_REACH = 3.2
const DRIFT_PERIOD = { x: 5600, y: 7100, breath: 4300 }

export interface Drift {
  x: MotionValue<number>
  y: MotionValue<number>
  /** A breath on the seat's outline: 1 ± 3%. */
  scale: MotionValue<number>
  /** The outline's slow turn, in degrees: a dashed circle that is alive, not spinning. */
  rotate: MotionValue<number>
}

/**
 * A seat that is not in floats: a small, slow Lissajous loop on its own phase and tempo, so no
 * two seats ever move in step and the map never pulses as one. `floating` eases the drift in and
 * out — a person let in settles onto their place, and drifts off it again when let out.
 */
export function useDrift(clock: MotionValue<number>, seed: number, floating: boolean): Drift {
  const reach = useSpring(floating ? 1 : 0, { stiffness: 40, damping: 14 })
  useEffect(() => {
    reach.set(floating ? 1 : 0)
  }, [floating, reach])

  // Each seat its own tempo (±18%) and phase, from its id.
  const tempo = 0.82 + seed * 0.36
  const phase = seed * Math.PI * 2
  const wave = (t: number, period: number, offset: number) => Math.sin((t / (period * tempo)) * Math.PI * 2 + offset)

  const x = useTransform([clock, reach], ([t, r]: number[]) => r * DRIFT_REACH * wave(t, DRIFT_PERIOD.x, phase))
  const y = useTransform([clock, reach], ([t, r]: number[]) => r * DRIFT_REACH * wave(t, DRIFT_PERIOD.y, phase * 1.7 + 1))
  const scale = useTransform([clock, reach], ([t, r]: number[]) => 1 + r * 0.03 * wave(t, DRIFT_PERIOD.breath, phase * 0.6))
  const rotate = useTransform([clock, reach], ([t, r]: number[]) => (r * t * (seed > 0.5 ? 1 : -1) * 360) / 26000)
  return { x, y, scale, rotate }
}

/* ------------------------------------------------------------------------------------------ */
/*  The line                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/** How much a line bows, as a share of its length. Every line bows the same way round. */
const BOW = 0.13
/**
 * The line's middle follows its ends on a soft spring: when a seat moves the line trails and
 * swings like a thread, then settles. Underdamped on purpose — that one swing is the life.
 */
const THREAD = { stiffness: 110, damping: 11, mass: 0.9 }
/** Drawing a line in: quick out of you, easing into them. */
const DRAW_IN = { type: "spring", stiffness: 70, damping: 17, mass: 0.9 } as const
const DRAW_OUT = { duration: 0.32, ease: EASE_EXIT } as const

interface Ends {
  ax: number
  ay: number
  bx: number
  by: number
  /** Where the bow would sit at rest. */
  qx: number
  qy: number
}

function ends(cx: number, cy: number, sx: number, sy: number, fromEdge: number, toEdge: number): Ends {
  const dx = sx - cx
  const dy = sy - cy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const ax = cx + ux * fromEdge
  const ay = cy + uy * fromEdge
  const bx = sx - ux * toEdge
  const by = sy - uy * toEdge
  const bow = Math.max(0, len - fromEdge - toEdge) * BOW
  // Perpendicular, clockwise: all lines curl the same way, like arms of one spiral.
  return { ax, ay, bx, by, qx: (ax + bx) / 2 - uy * bow, qy: (ay + by) / 2 + ux * bow }
}

const HIDDEN = { pathLength: 0, opacity: 0 }

const bezier = (a: number, q: number, b: number, t: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * q + t * t * b

export interface AudienceLinkProps {
  /** The centre of your ring, and of the seat — in the SVG's own coordinates. */
  cx: MotionValue<number>
  cy: MotionValue<number>
  sx: MotionValue<number>
  sy: MotionValue<number>
  /** Where the line stops short of the ring and of the seat, in px from each centre. */
  fromEdge: number
  toEdge: number
  on: boolean
  reduce: boolean
  /** The seat's own phase, so the light along different lines never travels in step. */
  seed: number
  /** Light travelling along it. Off for lines in a crowd, where it would be noise. */
  pulse?: boolean
  /** A quieter line: shared through All friends rather than by name. */
  faint?: boolean
}

/**
 * The line from you to someone you let in: a thread, not a ruler stroke.
 *
 * - It **bows**, every line the same way round, so many of them read as one spiral around you.
 * - It **has weight**: its middle follows its ends on an underdamped spring, so when a seat
 *   glides to a new place the line trails it, swings once and settles.
 * - It is **drawn out of you** on a spring when someone is let in, and the seat answers with a
 *   ripple the moment the line reaches it. Let out, it is reeled back into the ring.
 * - **Light travels along it**, from you to them, now and then — what was shared, on its way.
 *   Each line on its own tempo, faded in and out at the ends, and never under reduced motion.
 *
 * Two strokes: a soft wide one under a hairline, which reads as depth without a filter.
 *
 * A thread exists only while it is drawn or being reeled in: a drifting seat moves every frame,
 * and a hidden thread recomputing its curve behind every one of them would be the map's whole
 * cost. Threads already there when the picture appears are simply there — no drawing, no ripple.
 */
export function AudienceLink(props: AudienceLinkProps) {
  const { on, reduce } = props
  const [shown, setShown] = useState(on)
  const appeared = useRef(false)
  useEffect(() => {
    appeared.current = true
  }, [])
  useEffect(() => {
    if (on || reduce) {
      setShown(on)
      return
    }
    // Reeled in, then gone.
    const timer = setTimeout(() => setShown(false), REEL_MS)
    return () => clearTimeout(timer)
  }, [on, reduce])
  return shown || on ? <Thread {...props} drawIn={appeared.current} /> : null
}

const REEL_MS = 400

function Thread({
  cx,
  cy,
  sx,
  sy,
  fromEdge,
  toEdge,
  on,
  reduce,
  seed,
  pulse = true,
  faint = false,
  drawIn,
}: AudienceLinkProps & { drawIn: boolean }) {  const rest = useTransform([cx, cy, sx, sy], ([a, b, c, d]: number[]) => ends(a, b, c, d, fromEdge, toEdge))
  const idealQx = useTransform(rest, (e) => e.qx)
  const idealQy = useTransform(rest, (e) => e.qy)
  const springQx = useSpring(idealQx, THREAD)
  const springQy = useSpring(idealQy, THREAD)
  const qx = reduce ? idealQx : springQx
  const qy = reduce ? idealQy : springQy
  const d = useTransform([cx, cy, sx, sy, qx, qy], ([a, b, c, e, x, y]: number[]) => {
    const r = ends(a, b, c, e, fromEdge, toEdge)
    return `M${r.ax.toFixed(2)} ${r.ay.toFixed(2)} Q${x.toFixed(2)} ${y.toFixed(2)} ${r.bx.toFixed(2)} ${r.by.toFixed(2)}`
  })

  // Light along the line: t runs 0 → 1 from you to them, then waits.
  const t = useMotionValue(0)
  const travelling = on && pulse && !reduce
  useEffect(() => {
    if (!travelling) {
      t.set(0)
      return
    }
    const controls = animate(t, [0, 1], {
      duration: 1.9 + seed * 0.9,
      ease: [0.45, 0, 0.25, 1],
      repeat: Infinity,
      repeatDelay: 2.4 + seed * 2.2,
      // After the line has drawn in; then each on its own beat.
      delay: 0.9 + seed * 1.6,
    })
    return () => controls.stop()
  }, [travelling, seed, t])
  const sparkX = useTransform([cx, cy, sx, sy, qx, t], ([a, b, c, e, x, k]: number[]) => {
    const r = ends(a, b, c, e, fromEdge, toEdge)
    return bezier(r.ax, x, r.bx, k)
  })
  const sparkY = useTransform([cx, cy, sx, sy, qy, t], ([a, b, c, e, y, k]: number[]) => {
    const r = ends(a, b, c, e, fromEdge, toEdge)
    return bezier(r.ay, y, r.by, k)
  })
  // Brightest in the middle of its way, nothing at either end.
  const sparkOpacity = useTransform(t, (s) => (s <= 0 || s >= 1 ? 0 : Math.sin(Math.PI * s) ** 1.5))

  // The seat's answer when the line reaches it: a ripple, once per letting in.
  const [answers, setAnswers] = useState(drawIn && on && !reduce ? 1 : 0)
  const was = useRef(on)
  useEffect(() => {
    if (on && !was.current && !reduce) setAnswers((n) => n + 1)
    was.current = on
  }, [on, reduce])

  const drawn = { pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }
  const draw = reduce ? { duration: 0 } : on ? { pathLength: DRAW_IN, opacity: { duration: 0.18 } } : DRAW_OUT

  return (
    <g>
      <motion.path
        d={d}
        initial={drawIn ? HIDDEN : false}
        animate={drawn}
        transition={draw}
        strokeWidth={7}
        strokeLinecap="round"
        className={cn("stroke-ink", faint ? "[stroke-opacity:0.03]" : "[stroke-opacity:0.07]")}
      />
      <motion.path
        d={d}
        initial={drawIn ? HIDDEN : false}
        animate={drawn}
        transition={draw}
        strokeWidth={1.6}
        strokeLinecap="round"
        className={cn("stroke-ink", faint && "[stroke-opacity:0.35]")}
      />
      {travelling && (
        <>
          <motion.circle cx={sparkX} cy={sparkY} r={6} style={{ opacity: sparkOpacity }} className="fill-ink [fill-opacity:0.12]" />
          <motion.circle cx={sparkX} cy={sparkY} r={2.4} style={{ opacity: sparkOpacity }} className="fill-ink" />
        </>
      )}
      {answers > 0 && (
        <motion.circle
          key={answers}
          cx={sx}
          cy={sy}
          fill="none"
          strokeWidth={1.5}
          className="stroke-ink"
          initial={{ r: toEdge - 4, opacity: 0 }}
          animate={{ r: [toEdge - 4, toEdge + 14], opacity: [0, 0.45, 0] }}
          transition={{ duration: 0.8, delay: 0.32, ease: "easeOut", times: [0, 0.15, 1] }}
        />
      )}
    </g>
  )
}
