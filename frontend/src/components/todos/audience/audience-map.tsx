"use client"

import Link from "next/link"
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  AnimatePresence,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion"
import { Check, Minus, Plus, Scan, UsersRound } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { AudienceRing } from "@/components/ui/audience-ring"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { FriendAvatar } from "@/components/todos/edit-todo-modal/friend-avatar"
import { useFriendAffinity } from "@/hooks/use-friend-affinity"
import {
  DURATION_FAST,
  DURATION_UI,
  EASE_EXIT,
  EASE_OUT_EXPO,
  SPRING_GENTLE,
  SPRING_LAYOUT,
  TAP_PRESS,
} from "@/lib/animations"
import {
  MIN_ZOOM,
  RING_SIZE,
  openingZoom,
  SEAT_SIZE,
  audienceSentence,
  clampPan,
  firstName,
  fitZoom,
  mapRadius,
  personName,
  rankByAffinity,
  seatPositions,
  zoomAround,
} from "@/lib/audience-map"
import type { FriendDto } from "@/types/auth"
import { cn } from "@/lib/utils"

/**
 * Who can see a task — the landing page's first block, made real.
 *
 * The landing page teaches the product's one idea with a circle: you in the ring, three seats
 * around you, and a line to everyone you let in. This is that circle with the owner's real
 * friends in the seats, in the task editor and on a task's own page, in place of the old
 * Private/Friends switch and its list of check-boxes.
 *
 * - **The closest friends sit closest.** Seats are laid on a sunflower spiral, ranked by how
 *   much you share with each friend both ways and how recently (`friend-affinity`); the
 *   spiral's distance grows with the rank and nothing else. Until the closeness arrives the
 *   friends sit in name order, and when it does they glide to their seats.
 * - **Nobody chosen shows no face.** An empty seat is the landing's dashed circle with a plus;
 *   choosing someone springs their avatar into it, draws the line to them and opens the ring a
 *   little wider. Pressing them again lets them out.
 * - **The map zooms and moves, the page does not.** The wheel zooms around the pointer, a drag
 *   moves the map, two fingers pinch it; − / fit / + do the same for everyone else. The wheel is
 *   taken only over the map (a non-passive listener and `overscroll-behavior: contain`), so the
 *   page and the map never scroll together. Every change of view glides on one smoothing curve,
 *   so a wheel's notches read as one motion, and the point under the pointer stays put.
 * - **The chips are the control.** As on the landing page the picture is `aria-hidden` and its
 *   seats are pointer targets only; the chips under it carry each toggle with its name and
 *   pressed state, so keyboards and screen readers get it once, where it is labelled.
 *
 * The audience itself — private, chosen people, all friends — is the editor's, through the same
 * callbacks the old panel used, so what is saved and when is unchanged: choosing the last
 * friend who is not yet in turns the task into All friends, letting someone out of All friends
 * leaves it shared with everyone else, and nobody chosen is private.
 */

export interface AudienceMapProps {
  friends: FriendDto[]
  mode: "private" | "friends"
  sharedIds: string[]
  /** Shared with every friend (the server's `IsPublic`). */
  allFriends: boolean
  /** The circle an All friends task was frozen with, when known; otherwise every current friend. */
  allFriendsIds?: readonly string[] | null
  onModeChange: (mode: "private" | "friends") => void
  onSharedIdsChange: (ids: string[]) => void
  /** A friend's task: shown as it is, nothing can be changed. */
  readOnly?: boolean
  /** The popover's map is a little shorter than the page's. */
  size?: "popover" | "page"
}

const STAGE_HEIGHT = { popover: 248, page: 296 } as const

export function AudienceMap({
  friends,
  mode,
  sharedIds,
  allFriends,
  allFriendsIds,
  onModeChange,
  onSharedIdsChange,
  readOnly = false,
  size = "popover",
}: AudienceMapProps) {
  const reduce = useReducedMotion() ?? false
  const labelId = useId()
  const affinity = useFriendAffinity(friends.length > 0)
  const ranked = useMemo(() => rankByAffinity(friends, affinity), [friends, affinity])

  /** Who is in, as the seats show it. */
  const inIds = useMemo(() => {
    if (allFriends) {
      const known = new Set(friends.map((f) => f.id))
      const frozen = (allFriendsIds ?? []).filter((id) => known.has(id))
      return frozen.length > 0 ? frozen : friends.map((f) => f.id)
    }
    return mode === "private" ? [] : sharedIds
  }, [allFriends, allFriendsIds, friends, mode, sharedIds])
  const inSet = useMemo(() => new Set(inIds), [inIds])
  const inPeople = ranked.filter((f) => inSet.has(f.id))

  const toggle = (id: string) => {
    if (readOnly) return
    const next = inSet.has(id) ? inIds.filter((x) => x !== id) : [...inIds, id]
    if (next.length === 0) {
      onSharedIdsChange([])
      onModeChange("private")
      return
    }
    if (mode !== "friends") onModeChange("friends")
    onSharedIdsChange(next)
  }

  const everyone = () => {
    if (readOnly) return
    if (allFriends) {
      onSharedIdsChange([])
      onModeChange("private")
      return
    }
    onModeChange("friends")
    onSharedIdsChange(friends.map((f) => f.id))
  }

  const onlyYou = () => {
    if (readOnly) return
    onSharedIdsChange([])
    onModeChange("private")
  }

  const audience = allFriends ? "public" : inIds.length > 0 ? "shared" : "private"
  const sentence = readOnly
    ? allFriends
      ? "Its owner shared it with all their friends."
      : inIds.length > 0
        ? `Its owner shared it with ${inIds.length} ${inIds.length === 1 ? "person" : "people"} you know.`
        : "Only its owner can see this."
    : audienceSentence(inPeople.map((p) => firstName(p)), allFriends)

  return (
    <div>
      <Stage
        people={ranked}
        inSet={inSet}
        audience={audience}
        viewerCount={inIds.length}
        height={STAGE_HEIGHT[size]}
        reduce={reduce}
        readOnly={readOnly}
        onToggle={toggle}
      />

      <p aria-live="polite" className="relative mt-4 min-h-12 text-body font-bold tracking-tight text-ink">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={sentence}
            className="block"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION_UI, ease: EASE_OUT_EXPO } }}
            exit={
              reduce
                ? { opacity: 0, transition: { duration: DURATION_FAST } }
                : { opacity: 0, y: -8, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }
            }
          >
            {sentence}
          </motion.span>
        </AnimatePresence>
      </p>

      {friends.length === 0 ? (
        <p className="mt-2 text-caption font-semibold text-ink-muted">
          No friends to share with yet. Add them on your{" "}
          <Link
            href="/profile#friends"
            className="touch-target rounded-sm text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
          >
            profile
          </Link>
          , then share this task.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p id={labelId} className={FIELD_LABEL_CLASS}>
              Share with
            </p>
            <AnimatePresence initial={false}>
              {!readOnly && inIds.length > 0 && (
                <motion.button
                  key="only-you"
                  type="button"
                  onClick={onlyYou}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DURATION_FAST }}
                  className="touch-target -mr-1 rounded-full px-2 text-caption font-semibold text-ink-muted transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
                >
                  Only you
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          <div
            role="group"
            aria-labelledby={labelId}
            aria-disabled={readOnly || undefined}
            // Many friends wrap into rows that scroll inside the panel — and only inside it.
            className="-mx-1 mt-2 flex max-h-[7.75rem] flex-wrap gap-2 overflow-y-auto overscroll-contain px-1 pb-1 pt-0.5"
          >
            <Chip
              label="All friends"
              ariaLabel="Share with all friends"
              on={allFriends}
              disabled={readOnly}
              reduce={reduce}
              onClick={everyone}
              lead={
                <span className="grid h-7 w-7 place-items-center rounded-full bg-paper-sunken text-ink" aria-hidden="true">
                  <UsersRound className="h-3.5 w-3.5" />
                </span>
              }
            />
            {ranked.map((friend) => (
              <Chip
                key={friend.id}
                label={firstName(friend)}
                ariaLabel={`Share with ${personName(friend)}`}
                on={inSet.has(friend.id)}
                disabled={readOnly}
                reduce={reduce}
                onClick={() => toggle(friend.id)}
                lead={<FriendAvatar friend={friend} size={28} />}
              />
            ))}
          </div>
        </>
      )}

      {readOnly && (
        <p className="mt-3 text-caption text-ink-muted">Only the task&rsquo;s owner can change who sees it.</p>
      )}
    </div>
  )
}

/** A person to let in: the landing's chip — avatar, first name, and a plus that turns into a check. */
function Chip({
  label,
  ariaLabel,
  on,
  disabled,
  reduce,
  onClick,
  lead,
}: {
  label: string
  ariaLabel: string
  on: boolean
  disabled: boolean
  reduce: boolean
  onClick: () => void
  lead: React.ReactNode
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={on}
      disabled={disabled}
      whileTap={reduce || disabled ? undefined : TAP_PRESS}
      className={cn(
        "relative inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border py-1 pl-1 pr-3",
        "text-body-sm font-semibold transition-colors duration-fast disabled:cursor-default",
        on ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink enabled:hover:bg-paper-sunken",
        disabled && !on && "opacity-60",
      )}
    >
      <span aria-hidden="true" className="inline-flex">
        {lead}
      </span>
      <span className="truncate">{label}</span>
      <span aria-hidden="true" className="grid h-4 w-4 flex-shrink-0 place-items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={on ? "on" : "off"}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduce ? 1 : 0.6 }}
            transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
            className="grid place-items-center"
          >
            {on ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  )
}

type View = { x: number; y: number; scale: number }

/** How quickly the view catches up with where it is going: one curve for every change. */
const VIEW_SMOOTHING_MS = 70
/** A press that moves farther than this is a drag, not a press. */
const DRAG_THRESHOLD = 4

/**
 * The picture: you in the ring at the centre of an endless dotted sheet, every friend on a seat
 * of the spiral, a line to each person who is in. A world layer carries the drawing and is moved
 * and scaled as one (`x`, `y`, `scale` on the compositor); the dots move with it, so a drag reads
 * as moving the sheet, not the people on it.
 */
function Stage({
  people,
  inSet,
  audience,
  viewerCount,
  height,
  reduce,
  readOnly,
  onToggle,
}: {
  people: FriendDto[]
  inSet: ReadonlySet<string>
  audience: "private" | "shared" | "public"
  viewerCount: number
  height: number
  reduce: boolean
  readOnly: boolean
  onToggle: (id: string) => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const positions = useMemo(() => seatPositions(people.length), [people.length])
  const radius = mapRadius(people.length)
  const fit = width > 0 ? fitZoom(width, height, radius) : 1
  // A list longer than the floor allows is still shown whole: the floor gives way to the fit.
  const exactFit = width > 0 ? (Math.min(width, height) / 2 - 12) / radius : 1
  const minZoom = width > 0 ? Math.max(0.12, Math.min(MIN_ZOOM, exactFit)) : MIN_ZOOM
  /** "Show everyone": the whole spiral in view, however long it is. */
  const everyoneZoom = Math.min(1, Math.max(minZoom, exactFit))
  const overflows = fit < openingZoom(fit)

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const scale = useMotionValue(1)
  const target = useRef<View>({ x: 0, y: 0, scale: 1 })
  const current = useRef<View>({ x: 0, y: 0, scale: 1 })
  const frame = useRef<number | null>(null)
  const last = useRef(0)
  const [moved, setMoved] = useState(false)
  const [grabbing, setGrabbing] = useState(false)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const write = useCallback(
    (view: View) => {
      current.current = view
      x.set(view.x)
      y.set(view.y)
      scale.set(view.scale)
    },
    [x, y, scale],
  )

  /** Ease the drawn view toward the target, frame by frame, until they meet. */
  const step = useCallback(
    (now: number) => {
      const dt = last.current ? Math.min(64, now - last.current) : 16
      last.current = now
      const a = 1 - Math.exp(-dt / VIEW_SMOOTHING_MS)
      const c = current.current
      const t = target.current
      const next = { x: c.x + (t.x - c.x) * a, y: c.y + (t.y - c.y) * a, scale: c.scale + (t.scale - c.scale) * a }
      const done = Math.abs(t.x - next.x) < 0.1 && Math.abs(t.y - next.y) < 0.1 && Math.abs(t.scale - next.scale) < 0.0005
      write(done ? t : next)
      frame.current = done ? null : requestAnimationFrame(step)
      if (done) last.current = 0
    },
    [write],
  )

  const goTo = useCallback(
    (view: View, immediate = false) => {
      target.current = clampPan(view, radius, width || 1, height)
      if (immediate || reduce) {
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = null
        last.current = 0
        write(target.current)
        return
      }
      if (frame.current === null) frame.current = requestAnimationFrame(step)
    },
    [radius, width, height, reduce, step, write],
  )

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
  }, [])

  // On arrival, and whenever the number of seats changes, the view opens close enough to read
  // the nearest names (everyone, if they fit) — until it has been moved by hand, which is then
  // left where it was put.
  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (width === 0) return
    const key = `${people.length}:${width}:${height}`
    if (moved || fittedFor.current === key) return
    const first = fittedFor.current === null
    fittedFor.current = key
    goTo({ x: 0, y: 0, scale: openingZoom(fit) }, first)
  }, [fit, goTo, height, moved, people.length, width])

  /* The wheel zooms around the pointer, over the map only: taken from the page (not passive). */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
      const px = event.clientX - rect.left - rect.width / 2
      const py = event.clientY - rect.top - rect.height / 2
      // A pinch on a trackpad arrives as a wheel with Ctrl held, in much smaller steps.
      const factor = Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.0018))
      const zoomed = zoomAround(target.current, factor, px, py, minZoom)
      setMoved(true)
      goTo({ ...zoomed, x: zoomed.x - event.deltaX * unit })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [goTo, minZoom])

  /* Drag to move, two fingers to pinch. A press that moves is not a press on a seat. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ x: number; y: number; view: View; dragging: boolean } | null>(null)
  const pinch = useRef<{ distance: number; view: View; cx: number; cy: number } | null>(null)
  const swallowClick = useRef(false)

  const local = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    return rect ? { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 } : { x: 0, y: 0 }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    if ((event.target as Element).closest("[data-map-control]")) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 1) {
      drag.current = { x: event.clientX, y: event.clientY, view: { ...target.current }, dragging: false }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2)
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, view: { ...target.current }, cx: mid.x, cy: mid.y }
      drag.current = null
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance
      const { view, cx, cy } = pinch.current
      setMoved(true)
      goTo(zoomAround(view, ratio, cx, cy, minZoom), true)
      return
    }
    const d = drag.current
    if (!d) return
    const dx = event.clientX - d.x
    const dy = event.clientY - d.y
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      d.dragging = true
      setGrabbing(true)
      // Captured only once it is a drag: capturing on press would steal the click from a seat.
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    setMoved(true)
    // The map follows the hand at once; only wheel and buttons glide.
    goTo({ ...d.view, x: d.view.x + dx, y: d.view.y + dy }, true)
  }

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (drag.current?.dragging) swallowClick.current = true
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) {
      drag.current = null
      setGrabbing(false)
    }
  }

  const zoomBy = (factor: number) => {
    setMoved(true)
    goTo(zoomAround(target.current, factor, 0, 0, minZoom))
  }

  // Names fade out once the map is zoomed far enough out that they would be smaller than legible.
  const labels = useTransform(scale, [0.5, 0.72], [0, 1])
  const dotSize = useTransform(scale, (s) => `${16 * s}px ${16 * s}px`)
  const dots = useMotionTemplate`calc(50% + ${x}px) calc(50% + ${y}px)`

  const seats = people.map((person, rank) => ({ person, pos: positions[rank], rank, on: inSet.has(person.id) }))

  return (
    <div
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onClickCapture={(event) => {
        if (!swallowClick.current) return
        swallowClick.current = false
        event.stopPropagation()
        event.preventDefault()
      }}
      onDoubleClick={(event) => {
        if ((event.target as Element).closest("[data-seat],[data-map-control]")) return
        const p = local(event.clientX, event.clientY)
        setMoved(true)
        goTo(zoomAround(target.current, 1.6, p.x, p.y, minZoom))
      }}
      className={cn(
        "relative select-none overflow-hidden rounded-lg bg-paper-sunken [overscroll-behavior:contain] [touch-action:pan-y]",
        grabbing ? "cursor-grabbing" : "cursor-grab",
      )}
      style={{ height }}
    >
      {/* The sheet's dots, moving and scaling with the drawing. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--pl-ink-faint)_1px,transparent_1px)]"
        style={{ backgroundSize: dotSize, backgroundPosition: dots }}
      />

      <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-0 w-0">
        <motion.div className="absolute left-0 top-0" style={{ x, y, scale, transformOrigin: "0 0" }}>
          <div className="absolute left-0 top-0 z-[1] -translate-x-1/2 -translate-y-1/2">
            <AudienceRing audience={audience} viewerCount={viewerCount} size={RING_SIZE} stroke={5} drawIn>
              {/* Not Avatar: it derives initials, and "You" would read "YO". */}
              <span className="grid h-11 w-11 place-items-center rounded-full bg-ink text-caption font-bold text-paper">
                You
              </span>
            </AudienceRing>
          </div>

          {seats.map(({ person, pos, rank, on }) => (
            <Seat
              key={person.id}
              person={person}
              x={pos.x}
              y={pos.y}
              rank={rank}
              on={on}
              reduce={reduce}
              readOnly={readOnly}
              labels={labels}
              onToggle={onToggle}
            />
          ))}
        </motion.div>
      </div>

      {overflows && !moved && (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2.5 left-3 rounded-full bg-paper/80 px-2 py-0.5 text-caption font-semibold text-ink-muted backdrop-blur-sm"
        >
          <span className="[@media(pointer:coarse)]:hidden">Scroll to zoom · drag to move</span>
          <span className="hidden [@media(pointer:coarse)]:inline">Pinch to zoom · drag sideways to move</span>
        </p>
      )}

      {/* Outside the hidden picture: these are real, named controls. */}
      <div
        data-map-control=""
        className="absolute bottom-2 right-2 flex items-center rounded-full border border-line/80 bg-paper/90 p-0.5 shadow-sm backdrop-blur-sm"
      >
        <MapButton label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
          <Minus className="h-3.5 w-3.5" />
        </MapButton>
        <MapButton
          label="Show everyone"
          onClick={() => {
            // A choice of view like any other: the opening view must not take it back.
            setMoved(true)
            goTo({ x: 0, y: 0, scale: everyoneZoom })
          }}
        >
          <Scan className="h-3.5 w-3.5" />
        </MapButton>
        <MapButton label="Zoom in" onClick={() => zoomBy(1.4)}>
          <Plus className="h-3.5 w-3.5" />
        </MapButton>
      </div>
    </div>
  )
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={TAP_PRESS}
      onClick={onClick}
      className="touch-target grid h-8 w-8 place-items-center rounded-full text-ink-muted transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
    >
      {children}
    </motion.button>
  )
}

/** The seats' glide: the layout spring, as motion values, so a seat and its line move as one. */
const SEAT_SPRING = { stiffness: 400, damping: 40 }
const RING_EDGE = RING_SIZE / 2 + 4
const SEAT_EDGE = SEAT_SIZE / 2 + 4

const towards = (a: number, b: number) => {
  const len = Math.hypot(a, b) || 1
  return { ux: a / len, uy: b / len }
}

/**
 * One seat, and the line to it. On arrival the seats pour out of the ring, closest first; when
 * the ranking changes they glide to their new places. The seat's place is a pair of springs, and
 * the line is drawn from the same springs — ring edge to seat edge — so it can never point at
 * where the seat used to be. Positioned by the wrapper and pressed on the button inside it, as on
 * the landing page: a scale on the positioned node would fight its placement.
 */
function Seat({
  person,
  x,
  y,
  rank,
  on,
  reduce,
  readOnly,
  labels,
  onToggle,
}: {
  person: FriendDto
  x: number
  y: number
  rank: number
  on: boolean
  reduce: boolean
  readOnly: boolean
  labels: MotionValue<number>
  onToggle: (id: string) => void
}) {
  const sx = useSpring(reduce ? x : x * 0.35, SEAT_SPRING)
  const sy = useSpring(reduce ? y : y * 0.35, SEAT_SPRING)
  const arrived = useRef(false)

  useEffect(() => {
    if (reduce) {
      sx.jump(x)
      sy.jump(y)
      arrived.current = true
      return
    }
    // The first move is the pour-out, staggered by closeness; every later move is a glide.
    const delay = arrived.current ? 0 : Math.min(rank, 24) * 25
    const timer = setTimeout(() => {
      sx.set(x)
      sy.set(y)
      arrived.current = true
    }, delay)
    return () => clearTimeout(timer)
  }, [x, y, rank, reduce, sx, sy])

  const x1 = useTransform([sx, sy], ([a, b]: number[]) => towards(a, b).ux * RING_EDGE)
  const y1 = useTransform([sx, sy], ([a, b]: number[]) => towards(a, b).uy * RING_EDGE)
  const x2 = useTransform([sx, sy], ([a, b]: number[]) => a - towards(a, b).ux * SEAT_EDGE)
  const y2 = useTransform([sx, sy], ([a, b]: number[]) => b - towards(a, b).uy * SEAT_EDGE)
  const name = firstName(person)

  return (
    <>
      <svg className="pointer-events-none absolute left-0 top-0 z-0 overflow-visible" width={1} height={1} fill="none">
        <motion.line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          initial={false}
          animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : DURATION_UI, ease: EASE_OUT_EXPO }}
          strokeWidth={1.5}
          className="stroke-ink"
        />
      </svg>
      <motion.div
        data-seat=""
        className="absolute left-0 top-0 z-[2]"
        style={{ x: sx, y: sy, width: SEAT_SIZE, height: SEAT_SIZE, marginLeft: -SEAT_SIZE / 2, marginTop: -SEAT_SIZE / 2 }}
        initial={reduce ? false : { opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduce ? { duration: 0 } : { ...SPRING_LAYOUT, delay: Math.min(rank, 24) * 0.025 }}
      >
        <motion.button
          type="button"
          tabIndex={-1}
          aria-label={on ? `Remove ${name}` : `Add ${name}`}
          onClick={() => onToggle(person.id)}
          disabled={readOnly}
          whileHover={reduce || readOnly ? undefined : { scale: 1.06 }}
          whileTap={reduce || readOnly ? undefined : TAP_PRESS}
          className={cn(
            "group relative grid h-full w-full place-items-center rounded-full",
            readOnly ? "cursor-default" : "cursor-pointer",
            // The name below the circle is part of the target: people aim at the word.
            "after:absolute after:-inset-x-3 after:-bottom-6 after:-top-1 after:content-['']",
          )}
        >
          <span
            className={cn(
              "absolute inset-0 grid place-items-center rounded-full border-2 border-dashed border-line-strong bg-paper-sunken",
              "transition-colors duration-fast",
              !readOnly && "group-hover:border-solid group-hover:border-ink group-hover:bg-paper",
            )}
          >
            <Plus className={cn("h-4 w-4 text-ink-subtle transition-colors duration-fast", !readOnly && "group-hover:text-ink")} />
          </span>
          <AnimatePresence initial={false}>
            {on && (
              <motion.span
                key="face"
                className="absolute inset-0"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                transition={SPRING_GENTLE}
              >
                <FriendAvatar friend={person} size={SEAT_SIZE} />
                {!readOnly && (
                  // Pressing a person again lets them out: the minus says so before the press.
                  <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-paper-sunken bg-ink text-paper opacity-0 transition-opacity duration-fast group-hover:opacity-100">
                    <Minus className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
        <motion.span
          style={{ opacity: labels }}
          className={cn(
            "pointer-events-none absolute left-1/2 top-full mt-1 max-w-[5.5rem] -translate-x-1/2 truncate whitespace-nowrap text-caption font-semibold",
            on ? "text-ink" : "text-ink-muted",
          )}
        >
          {name}
        </motion.span>
      </motion.div>
    </>
  )
}
