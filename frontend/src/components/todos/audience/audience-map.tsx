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
  animate,
  AnimatePresence,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion"
import { Check, ChevronRight, Lock, Minus, Plus, Scan, UsersRound, ZoomIn } from "lucide-react"
import { motion } from "@/components/ui/motion"
import { useInert } from "@/hooks/use-inert"
import { AudienceRing } from "@/components/ui/audience-ring"
import { AudienceLink, useClock, useDrift, useOnScreen } from "@/components/ui/audience-motion"
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
  MAX_SHARED_FRIENDS,
  MIN_ZOOM,
  RING_SIZE,
  SEAT_SIZE,
  assignSeats,
  audienceSentence,
  clampPan,
  firstName,
  mapRadius,
  nearestAngle,
  openingView,
  orbitLayout,
  orbitSlots,
  personName,
  rankByAffinity,
  seedOf,
  toggleAudience,
  zoomAround,
  type Slot,
} from "@/lib/audience-map"
import type { FriendDto } from "@/types/auth"
import { cn } from "@/lib/utils"

/**
 * Who can see a task — the landing page's first block, made real.
 *
 * The landing page teaches the product's one idea with a circle: you in the ring, seats around
 * you, and a line to everyone you let in. This is that circle with the owner's real friends in
 * the seats — in the task editor, on a task's own page and in the New task panel.
 *
 * - **Circles, closest first.** Friends sit on concentric circles around you, evenly spaced on
 *   each (`orbitSlots`). The first circle holds the people chosen and, around them, the friends
 *   you share the most with (`friend-affinity`); the rest fill the circles outward in the same
 *   order. Until the closeness arrives the friends sit in name order, and when it does they glide
 *   to their seats.
 * - **Choosing someone brings them in.** A friend chosen from a far circle travels to the first
 *   one, along the circles rather than through them (each seat is a radius and an angle on
 *   springs); the least close friend not chosen there steps out to make room, and everyone in
 *   between shifts by one seat, inner circles first.
 * - **At most twelve by name** (`MAX_SHARED_FRIENDS`, the server's limit). The first circle has
 *   exactly that many seats, a counter says how many are taken, and once it is full the friends
 *   outside it lock — pressing one shakes it and says why. All friends is not counted.
 * - **Nobody chosen shows no face, and drifts.** An empty seat is the landing's dashed circle with
 *   a plus, floating on its own slow loop; choosing someone settles it, springs their avatar in
 *   and draws the line to them (`AudienceLink`). Pressing them again lets them out.
 * - **The map zooms and moves, the page does not.** The wheel zooms around the pointer, a drag
 *   moves the map, two fingers pinch it; − / Show everyone / + do the same for everyone else,
 *   folded into one button in the corner until asked for (`MapDock`). The wheel is taken only
 *   over the map (a non-passive listener and `overscroll-behavior: contain`). It opens a touch
 *   closer than a plain fit, the first circle and its names framed on their middle (`openingView`).
 * - **One labelled control per person.** With chips (the editor and the task page) the picture is
 *   `aria-hidden` and the chips under it carry each toggle with its name and pressed state. Without
 *   them (the New task panel, where the map is the whole control) the seats themselves are the
 *   buttons — named, pressed, focusable — and focusing one brings it into view.
 *
 * The audience itself — private, chosen people, all friends — belongs to the caller, through
 * `onModeChange` / `onSharedIdsChange`: choosing the last friend who is not yet in turns the task
 * into All friends, letting someone out of All friends leaves it shared with everyone else, and
 * nobody chosen is private.
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
  /**
   * The "Share with" chips under the map. Off where the map is the whole control (New task):
   * the seats then become the buttons, and All friends / Only you sit on the map.
   */
  chips?: boolean
}

const STAGE_HEIGHT = { popover: 288, page: 320 } as const
/** How long the "why not" line stays after a refused press. */
const REFUSAL_MS = 3600

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
  chips = true,
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

  const chosenByName = allFriends ? 0 : inIds.length
  const full = !allFriends && chosenByName >= MAX_SHARED_FRIENDS

  /** A press the limit turned down: the counter shakes and the line under the map says why. */
  const [refusal, setRefusal] = useState<{ n: number; fromAll: boolean } | null>(null)
  useEffect(() => {
    if (!refusal) return
    const timer = setTimeout(() => setRefusal(null), REFUSAL_MS)
    return () => clearTimeout(timer)
  }, [refusal])

  const toggle = (id: string) => {
    if (readOnly) return
    const result = toggleAudience(inIds, id, allFriends)
    if (!result.ok) {
      setRefusal((r) => ({ n: (r?.n ?? 0) + 1, fromAll: allFriends }))
      return
    }
    setRefusal(null)
    const next = result.ids
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
    setRefusal(null)
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
    setRefusal(null)
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

  const limitNote = readOnly
    ? null
    : refusal?.fromAll
      ? `To choose by name, start from Only you — a task takes up to ${MAX_SHARED_FRIENDS} friends that way.`
      : full || refusal
        ? `That’s ${MAX_SHARED_FRIENDS}, the most one task can be shared with by name. All friends shares it with everyone.`
        : null

  const showCount = !readOnly && friends.length > MAX_SHARED_FRIENDS && chosenByName > 0

  return (
    <div>
      <Stage
        people={ranked}
        inSet={inSet}
        audience={audience}
        viewerCount={inIds.length}
        allFriends={allFriends}
        full={full}
        refusals={refusal?.n ?? 0}
        height={STAGE_HEIGHT[size]}
        reduce={reduce}
        readOnly={readOnly}
        interactive={!chips && !readOnly}
        onToggle={toggle}
        overlay={
          !chips && !readOnly && friends.length > 0 ? (
            <>
              <div data-map-control="" className="absolute left-2 top-2 flex items-center gap-1.5">
                <MapPill on={allFriends} onClick={everyone} label="All friends" pressed={allFriends} reduce={reduce}>
                  <UsersRound className="h-3.5 w-3.5" />
                </MapPill>
                <AnimatePresence initial={false}>
                  {inIds.length > 0 && (
                    <motion.div
                      key="only-you"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6 }}
                      transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
                    >
                      <MapPill onClick={onlyYou} label="Only you" reduce={reduce} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div data-map-control="" className="absolute right-2 top-2">
                <AnimatePresence initial={false}>
                  {showCount && <ShareCount key="count" count={chosenByName} refusals={refusal?.n ?? 0} reduce={reduce} />}
                </AnimatePresence>
              </div>
            </>
          ) : null
        }
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

      <AnimatePresence initial={false}>
        {limitNote && (
          <motion.p
            key="limit"
            role="status"
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
            className="overflow-hidden"
          >
            <span className="flex items-start gap-2 pb-1 text-caption font-semibold text-ink-muted">
              <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              {limitNote}
            </span>
          </motion.p>
        )}
      </AnimatePresence>

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
      ) : chips ? (
        <>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p id={labelId} className={cn(FIELD_LABEL_CLASS, "flex items-center gap-2")}>
              Share with
              <AnimatePresence initial={false}>
                {showCount && <ShareCount key="count" count={chosenByName} refusals={refusal?.n ?? 0} reduce={reduce} />}
              </AnimatePresence>
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
            {ranked.map((friend) => {
              const on = inSet.has(friend.id)
              return (
                <Chip
                  key={friend.id}
                  label={firstName(friend)}
                  ariaLabel={`Share with ${personName(friend)}`}
                  on={on}
                  locked={full && !on}
                  disabled={readOnly}
                  reduce={reduce}
                  onClick={() => toggle(friend.id)}
                  lead={<FriendAvatar friend={friend} size={28} />}
                />
              )
            })}
          </div>
        </>
      ) : null}

      {readOnly && (
        <p className="mt-3 text-caption text-ink-muted">Only the task&rsquo;s owner can change who sees it.</p>
      )}
    </div>
  )
}

/** "3/12": how many of the twelve seats by name are taken. Shakes when a press is refused. */
function ShareCount({ count, refusals, reduce }: { count: number; refusals: number; reduce: boolean }) {
  const full = count >= MAX_SHARED_FRIENDS
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (refusals === 0 || reduce || !ref.current) return
    const controls = animate(ref.current, { x: [0, -5, 5, -3, 3, 0] }, { duration: 0.42, ease: "easeOut" })
    return () => controls.stop()
  }, [refusals, reduce])
  return (
    <motion.span
      ref={ref}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
      aria-label={`${count} of ${MAX_SHARED_FRIENDS} friends chosen`}
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2 text-caption font-bold normal-case tabular-nums tracking-normal transition-colors duration-fast",
        full ? "bg-ink text-paper" : "bg-paper/90 text-ink-muted shadow-sm",
      )}
    >
      {count}
      <span className={full ? "text-paper/60" : "text-ink-subtle"}>/{MAX_SHARED_FRIENDS}</span>
    </motion.span>
  )
}

/** All friends / Only you, on the map itself, where there are no chips under it. */
function MapPill({
  label,
  on = false,
  pressed,
  reduce,
  onClick,
  children,
}: {
  label: string
  on?: boolean
  pressed?: boolean
  reduce: boolean
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      whileTap={reduce ? undefined : TAP_PRESS}
      className={cn(
        "touch-target inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-caption font-semibold shadow-sm backdrop-blur-sm transition-colors duration-fast",
        on ? "border-ink bg-ink text-paper" : "border-line/80 bg-paper/90 text-ink-muted hover:bg-paper hover:text-ink",
      )}
    >
      {children}
      {label}
    </motion.button>
  )
}

/** A person to let in: the landing's chip — avatar, first name, and a plus that turns into a check. */
function Chip({
  label,
  ariaLabel,
  on,
  locked = false,
  disabled,
  reduce,
  onClick,
  lead,
}: {
  label: string
  ariaLabel: string
  on: boolean
  /** Twelve are chosen: pressing this one is refused, and says why. */
  locked?: boolean
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
      aria-disabled={locked || undefined}
      disabled={disabled}
      whileTap={reduce || disabled || locked ? undefined : TAP_PRESS}
      className={cn(
        "relative inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border py-1 pl-1 pr-3",
        "text-body-sm font-semibold transition-[color,background-color,border-color,opacity] duration-fast disabled:cursor-default",
        on ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink enabled:hover:bg-paper-sunken",
        disabled && !on && "opacity-60",
        locked && "cursor-not-allowed opacity-45 enabled:hover:bg-paper",
      )}
    >
      <span aria-hidden="true" className="inline-flex">
        {lead}
      </span>
      <span className="truncate">{label}</span>
      <span aria-hidden="true" className="grid h-4 w-4 flex-shrink-0 place-items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={on ? "on" : locked ? "locked" : "off"}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduce ? 1 : 0.6 }}
            transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
            className="grid place-items-center"
          >
            {on ? <Check className="h-4 w-4" /> : locked ? <Lock className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />}
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
 * The picture: you in the ring at the centre of an endless dotted sheet, the circles the seats
 * sit on, every friend on a seat, a line to each person who is in. A world layer carries the
 * drawing and is moved and scaled as one (`x`, `y`, `scale` on the compositor); the dots move
 * with it, so a drag reads as moving the sheet, not the people on it.
 */
function Stage({
  people,
  inSet,
  audience,
  viewerCount,
  allFriends,
  full,
  refusals,
  height,
  reduce,
  readOnly,
  interactive,
  onToggle,
  overlay,
}: {
  people: FriendDto[]
  inSet: ReadonlySet<string>
  audience: "private" | "shared" | "public"
  viewerCount: number
  allFriends: boolean
  full: boolean
  refusals: number
  height: number
  reduce: boolean
  readOnly: boolean
  /** The seats are the buttons (no chips under the map). */
  interactive: boolean
  onToggle: (id: string) => void
  overlay: React.ReactNode
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const orbits = useMemo(() => orbitLayout(people.length), [people.length])
  const slots = useMemo(() => orbitSlots(people.length), [people.length])
  const seatOf = useMemo(() => assignSeats(people, inSet), [people, inSet])
  const radius = mapRadius(people.length)
  // The first circle a touch larger than a plain fit, framed on its middle (`openingView`).
  const opening = useMemo(() => openingView(width, height, people.length), [width, height, people.length])
  // A list longer than the floor allows is still shown whole: the floor gives way to the fit.
  const exactFit = width > 0 ? (Math.min(width, height) / 2 - 12) / radius : 1
  const minZoom = width > 0 ? Math.max(0.12, Math.min(MIN_ZOOM, exactFit)) : MIN_ZOOM
  /** "Show everyone": every circle in view, however many there are. */
  const everyoneZoom = Math.min(1, Math.max(minZoom, exactFit))
  const overflows = opening.overflows

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const scale = useMotionValue(1)
  const centre = useMotionValue(0)
  const target = useRef<View>({ x: 0, y: 0, scale: 1 })
  const current = useRef<View>({ x: 0, y: 0, scale: 1 })
  const frame = useRef<number | null>(null)
  const last = useRef(0)
  const [moved, setMoved] = useState(false)
  const [grabbing, setGrabbing] = useState(false)

  // One clock for every drifting seat, running only while the map is on screen.
  const inView = useOnScreen(stageRef)
  const clock = useClock(inView && !reduce)

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

  // On arrival, and whenever the number of seats changes, the view opens on the whole first
  // circle (everyone, if they fit) — until it has been moved by hand, which is then left
  // where it was put.
  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (width === 0) return
    const key = `${people.length}:${width}:${height}`
    if (moved || fittedFor.current === key) return
    const first = fittedFor.current === null
    fittedFor.current = key
    goTo({ x: opening.x, y: opening.y, scale: opening.scale }, first)
  }, [opening, goTo, height, moved, people.length, width])

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

  /** Whether a point of the drawing is inside the view where the view is heading, a seat clear of its edges. */
  const inSight = useCallback(
    (wx: number, wy: number, view: View = target.current) =>
      Math.abs(view.x + wx * view.scale) <= width / 2 - SEAT_SIZE &&
      Math.abs(view.y + wy * view.scale) <= height / 2 - SEAT_SIZE,
    [height, width],
  )

  /** A seat that took keyboard focus out of sight is brought to the middle of the view. */
  const reveal = useCallback(
    (wx: number, wy: number) => {
      if (inSight(wx, wy)) return
      const view = target.current
      setMoved(true)
      goTo({ scale: view.scale, x: -wx * view.scale, y: -wy * view.scale })
    },
    [goTo, inSight],
  )

  /*
   * Follow a person in. Chosen from a circle the view had been moved to, they travel to the first
   * circle — often out of the part being looked at. The view glides along with them: back to the
   * ring when the first circle fits at this zoom, otherwise to the seat they are taking.
   */
  const seenIn = useRef(inSet)
  useEffect(() => {
    const before = seenIn.current
    seenIn.current = inSet
    if (width === 0 || inSet.size !== before.size + 1) return
    const added = [...inSet].find((id) => !before.has(id))
    const slot = added === undefined ? undefined : slots[seatOf.get(added) ?? -1]
    if (!slot || inSight(slot.x, slot.y)) return
    const view = target.current
    // Home is the ring framed as the map opened: its middle, names included (`openingView`).
    const home = { scale: view.scale, x: 0, y: opening.scale > 0 ? (opening.y / opening.scale) * view.scale : 0 }
    goTo(inSight(slot.x, slot.y, home) ? home : { scale: view.scale, x: -slot.x * view.scale, y: -slot.y * view.scale })
  }, [goTo, inSet, inSight, opening, seatOf, slots, width])

  // Names fade out once the map is zoomed far enough out that they would be smaller than legible.
  const labels = useTransform(scale, [0.42, 0.58], [0, 1])
  // The sheet's dots scale with the drawing, but never closer than a legible grid: below that
  // they skip to every other dot, the way a map drops a grid level as it zooms out.
  const dotSize = useTransform(scale, (s) => {
    let step = 16 * s
    while (step < 11) step *= 2
    return `${step}px ${step}px`
  })
  const dots = useMotionTemplate`calc(50% + ${x}px) calc(50% + ${y}px)`

  return (
    <div
      ref={stageRef}
      role={interactive ? "group" : undefined}
      aria-label={interactive ? "Friends — choose who can see this task" : undefined}
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

      <div aria-hidden={interactive ? undefined : true} className="absolute left-1/2 top-1/2 h-0 w-0">
        <motion.div className="absolute left-0 top-0" style={{ x, y, scale, transformOrigin: "0 0" }}>
          <Orbits orbits={orbits} full={full} refusals={refusals} reduce={reduce} />

          <div aria-hidden="true" className="absolute left-0 top-0 z-[1] -translate-x-1/2 -translate-y-1/2">
            <AudienceRing audience={audience} viewerCount={viewerCount} size={RING_SIZE} stroke={5} drawIn>
              {/* Not Avatar: it derives initials, and "You" would read "YO". */}
              <span className="grid h-11 w-11 place-items-center rounded-full bg-ink text-caption font-bold text-paper">
                You
              </span>
            </AudienceRing>
          </div>

          {people.map((person, rank) => {
            const slot = slots[seatOf.get(person.id) ?? rank]
            if (!slot) return null
            const on = inSet.has(person.id)
            return (
              <Seat
                key={person.id}
                person={person}
                slot={slot}
                order={rank}
                on={on}
                locked={full && !on}
                faint={allFriends}
                reduce={reduce}
                readOnly={readOnly}
                interactive={interactive}
                labels={labels}
                clock={clock}
                centre={centre}
                onToggle={onToggle}
                onReveal={reveal}
              />
            )
          })}
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

      {overlay}

      {/* Outside the hidden picture: these are real, named controls. */}
      <MapDock
        reduce={reduce}
        onZoomOut={() => zoomBy(1 / 1.4)}
        onEveryone={() => {
          // A choice of view like any other: the opening view must not take it back.
          setMoved(true)
          goTo({ x: 0, y: 0, scale: everyoneZoom })
        }}
        onZoomIn={() => zoomBy(1.4)}
      />
    </div>
  )
}

/** A dock button's side, and the hairline between the tools and the toggle — in px. */
const DOCK_BUTTON = 32
const DOCK_DIVIDER = 5
/** The tools' strip, open: three buttons and the hairline. */
const DOCK_TOOLS_WIDTH = 3 * DOCK_BUTTON + DOCK_DIVIDER
/** The strip opens on a critically damped spring — no overshoot to pull back from — and closes quicker. */
const DOCK_OPEN = { type: "spring", stiffness: 380, damping: 36, mass: 0.9 } as const
const DOCK_CLOSE = { type: "spring", stiffness: 520, damping: 44 } as const

/**
 * The view's controls — zoom out, show everyone, zoom in — folded into one button in the
 * corner until they are asked for, so the map keeps its corner.
 *
 * Closed, the dock is a single round button with a magnifier. Pressed, a strip slides out of
 * it to the left on one spring and the tools come up into it one after another, the nearest
 * first; the magnifier turns into a chevron that folds them back. The strip is clipped
 * sideways only (`overflow-x: clip`), so every button keeps its full 44px target, and a folded
 * strip is inert: out of the tab order, the accessibility tree and the pointer.
 */
function MapDock({
  reduce,
  onZoomOut,
  onEveryone,
  onZoomIn,
}: {
  reduce: boolean
  onZoomOut: () => void
  onEveryone: () => void
  onZoomIn: () => void
}) {
  const [open, setOpen] = useState(false)
  const toolsId = useId()
  const toolsRef = useRef<HTMLDivElement>(null)
  useInert(toolsRef, !open)

  // Nearest the toggle first: the order they come up in, and the order Tab reaches them in.
  const tools = [
    { label: "Zoom in", icon: <Plus className="h-3.5 w-3.5" />, onClick: onZoomIn },
    { label: "Show everyone", icon: <Scan className="h-3.5 w-3.5" />, onClick: onEveryone },
    { label: "Zoom out", icon: <Minus className="h-3.5 w-3.5" />, onClick: onZoomOut },
  ]

  return (
    // Reversed rows: the toggle comes first to Tab and a screen reader, and sits at the right.
    <div
      data-map-control=""
      className="absolute bottom-2 right-2 flex flex-row-reverse items-center rounded-full border border-line/80 bg-paper/90 p-0.5 shadow-sm backdrop-blur-sm"
    >
      <MapButton
        label={open ? "Hide map controls" : "Map controls"}
        expanded={open}
        controls={toolsId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="relative grid h-3.5 w-3.5 place-items-center">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={open ? "fold" : "unfold"}
              className="grid place-items-center"
              initial={reduce ? { opacity: 0 } : { opacity: 0, rotate: open ? -90 : 90, scale: 0.6 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, rotate: open ? 90 : -90, scale: 0.6 }}
              transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
            >
              {open ? <ChevronRight className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
            </motion.span>
          </AnimatePresence>
        </span>
      </MapButton>
      <motion.div
        ref={toolsRef}
        id={toolsId}
        role="group"
        aria-label="Map view"
        initial={false}
        animate={{ width: open ? DOCK_TOOLS_WIDTH : 0 }}
        transition={reduce ? { duration: 0 } : open ? DOCK_OPEN : DOCK_CLOSE}
        // Overflowing to the left (`justify-end`): the strip uncovers the tool nearest the toggle first.
        className="flex flex-shrink-0 items-center justify-end overflow-x-clip"
      >
        <div className="flex flex-shrink-0 flex-row-reverse items-center">
          <span aria-hidden="true" className="mx-0.5 h-4 w-px rounded-full bg-line" />
          {tools.map((tool, i) => (
            <motion.span
              key={tool.label}
              className="grid"
              initial={false}
              animate={open ? { opacity: 1, scale: 1, x: 0 } : { opacity: 0, scale: 0.7, x: 6 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : open
                    ? { ...SPRING_GENTLE, delay: 0.04 + i * 0.035 }
                    : { duration: DURATION_FAST, ease: EASE_EXIT }
              }
            >
              <MapButton label={tool.label} onClick={tool.onClick}>
                {tool.icon}
              </MapButton>
            </motion.span>
          ))}
        </div>
      </motion.div>
    </div>
  )
}

function MapButton({
  label,
  expanded,
  controls,
  onClick,
  children,
}: {
  label: string
  /** The dock's toggle: whether the tools it shows are out. */
  expanded?: boolean
  controls?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      title={label}
      whileTap={TAP_PRESS}
      onClick={onClick}
      className={cn(
        // h-8 w-8: `DOCK_BUTTON`.
        "touch-target grid h-8 w-8 flex-shrink-0 place-items-center rounded-full transition-colors duration-fast hover:bg-ink/5 hover:text-ink",
        expanded ? "text-ink" : "text-ink-muted",
      )}
    >
      {children}
    </motion.button>
  )
}

/**
 * The circles the seats sit on, faint, so the order is visible even where seats are sparse. The
 * first one is the seats by name: it darkens when all twelve are taken, and flashes when a press
 * is refused.
 */
function Orbits({
  orbits,
  full,
  refusals,
  reduce,
}: {
  orbits: { radius: number; count: number }[]
  full: boolean
  refusals: number
  reduce: boolean
}) {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-0 overflow-visible" width={1} height={1} fill="none">
      {orbits.map(({ radius }, i) => (
        <motion.circle
          key={i}
          cx={0}
          cy={0}
          initial={reduce ? false : { r: radius * 0.6, opacity: 0 }}
          animate={{ r: radius, opacity: 1 }}
          transition={reduce ? { duration: 0 } : { ...SPRING_LAYOUT, delay: i * 0.06 }}
          strokeWidth={i === 0 ? 1.25 : 1}
          strokeDasharray={i === 0 ? undefined : "1.5 7"}
          strokeLinecap="round"
          className={cn(
            "stroke-ink transition-[stroke-opacity] duration-fast",
            i === 0 ? (full ? "[stroke-opacity:0.25]" : "[stroke-opacity:0.1]") : "[stroke-opacity:0.18]",
          )}
        />
      ))}
      {/* A refused press: the first circle flashes once. */}
      {refusals > 0 && !reduce && orbits[0] && (
        <motion.circle
          key={refusals}
          cx={0}
          cy={0}
          r={orbits[0].radius}
          strokeWidth={2}
          className="stroke-ink"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.5, 0] }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      )}
    </svg>
  )
}

/** A seat travels between places on these springs: unhurried, settling without a bounce. */
const SEAT_GLIDE = { stiffness: 120, damping: 21, mass: 1 }
const RING_EDGE = RING_SIZE / 2 + 4
const SEAT_EDGE = SEAT_SIZE / 2 + 4

/**
 * One seat, and the line to it.
 *
 * The seat's place is a radius and an angle on springs, not an x and a y: moving to another
 * place it travels round the circles (the short way, `nearestAngle`) and in or out between them,
 * so nobody cuts across the ring. On arrival the seats pour out of the ring in ranking order;
 * after that, when the seating changes, the inner circles move first and the outer ones follow,
 * and a person just chosen sets off at once. Not chosen, the seat drifts (`useDrift`); chosen, it
 * settles and the line is drawn to it from the same motion values, so the line never points at
 * where the seat used to be.
 *
 * Positioned by the wrapper and pressed on the button inside it, as on the landing page: a
 * scale on the positioned node would fight its placement.
 */
function Seat({
  person,
  slot,
  order,
  on,
  locked,
  faint,
  reduce,
  readOnly,
  interactive,
  labels,
  clock,
  centre,
  onToggle,
  onReveal,
}: {
  person: FriendDto
  slot: Slot
  /** Place in the ranking: the pour-out's order. */
  order: number
  on: boolean
  locked: boolean
  faint: boolean
  reduce: boolean
  readOnly: boolean
  interactive: boolean
  labels: MotionValue<number>
  clock: MotionValue<number>
  centre: MotionValue<number>
  onToggle: (id: string) => void
  onReveal: (x: number, y: number) => void
}) {
  const seed = useMemo(() => seedOf(person.id), [person.id])
  const radius = useSpring(reduce ? slot.radius : RING_SIZE / 2, SEAT_GLIDE)
  const angle = useSpring(slot.angle, SEAT_GLIDE)
  const arrived = useRef(false)
  const wasOn = useRef(on)

  useEffect(() => {
    const to = nearestAngle(angle.get(), slot.angle)
    if (reduce) {
      radius.jump(slot.radius)
      angle.jump(to)
      arrived.current = true
      return
    }
    // The pour-out, closest first; then inner circles before outer ones, the chosen at once.
    const justChosen = on && !wasOn.current
    wasOn.current = on
    const delay = !arrived.current ? Math.min(order, 24) * 22 : justChosen ? 0 : 60 + slot.orbit * 55 + seed * 40
    const timer = setTimeout(() => {
      radius.set(slot.radius)
      angle.set(nearestAngle(angle.get(), slot.angle))
      arrived.current = true
    }, delay)
    return () => clearTimeout(timer)
  }, [slot.radius, slot.angle, slot.orbit, on, order, reduce, seed, radius, angle])

  const drift = useDrift(clock, seed, !on && !reduce)
  const baseX = useTransform([radius, angle], ([r, a]: number[]) => r * Math.cos(a))
  const baseY = useTransform([radius, angle], ([r, a]: number[]) => r * Math.sin(a))
  const sx = useTransform([baseX, drift.x], ([b, d]: number[]) => b + d)
  const sy = useTransform([baseY, drift.y], ([b, d]: number[]) => b + d)

  const buttonRef = useRef<HTMLButtonElement>(null)
  const press = () => {
    if (readOnly) return
    if (locked && !reduce && buttonRef.current) {
      animate(buttonRef.current, { x: [0, -4, 4, -2, 2, 0] }, { duration: 0.4, ease: "easeOut" })
    }
    onToggle(person.id)
  }

  const name = firstName(person)

  return (
    <>
      <svg aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-0 overflow-visible" width={1} height={1} fill="none">
        <AudienceLink
          cx={centre}
          cy={centre}
          sx={sx}
          sy={sy}
          fromEdge={RING_EDGE}
          toEdge={SEAT_EDGE}
          on={on}
          reduce={reduce}
          seed={seed}
          pulse={!faint && slot.orbit === 0}
          faint={faint}
        />
      </svg>
      <motion.div
        data-seat=""
        className={cn("absolute left-0 top-0", on ? "z-[3]" : "z-[2]")}
        style={{ x: sx, y: sy, width: SEAT_SIZE, height: SEAT_SIZE, marginLeft: -SEAT_SIZE / 2, marginTop: -SEAT_SIZE / 2 }}
        initial={reduce ? false : { opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduce ? { duration: 0 } : { ...SPRING_LAYOUT, delay: Math.min(order, 24) * 0.022 }}
      >
        <motion.button
          ref={buttonRef}
          type="button"
          tabIndex={interactive ? 0 : -1}
          aria-label={interactive ? `Share with ${personName(person)}` : on ? `Remove ${name}` : `Add ${name}`}
          aria-pressed={interactive ? on : undefined}
          aria-disabled={locked || undefined}
          onClick={press}
          onFocus={interactive ? () => onReveal(sx.get(), sy.get()) : undefined}
          disabled={readOnly}
          whileHover={reduce || readOnly || locked ? undefined : { scale: 1.07 }}
          whileTap={reduce || readOnly || locked ? undefined : TAP_PRESS}
          className={cn(
            "group relative grid h-full w-full place-items-center rounded-full outline-none",
            "focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper-sunken",
            readOnly ? "cursor-default" : locked ? "cursor-not-allowed" : "cursor-pointer",
            // The name below the circle is part of the target: people aim at the word.
            "after:absolute after:-inset-x-3 after:-bottom-6 after:-top-1 after:content-['']",
          )}
        >
          {/* The outline breathes and turns slowly while the seat drifts; it stands still once chosen. */}
          <motion.span
            aria-hidden="true"
            style={{ scale: drift.scale, rotate: drift.rotate }}
            className={cn(
              "absolute inset-0 rounded-full border-2 border-dashed bg-paper-sunken transition-[border-color,background-color,opacity] duration-fast",
              locked ? "border-line opacity-60" : "border-line-strong",
              !readOnly && !locked && "group-hover:border-solid group-hover:border-ink group-hover:bg-paper",
            )}
          />
          <span aria-hidden="true" className="relative grid place-items-center">
            {locked ? (
              <Lock className="h-3.5 w-3.5 text-ink-subtle" />
            ) : (
              <Plus className={cn("h-4 w-4 text-ink-subtle transition-colors duration-fast", !readOnly && "group-hover:text-ink")} />
            )}
          </span>
          <AnimatePresence initial={false}>
            {on && (
              <motion.span
                key="face"
                aria-hidden="true"
                className="absolute inset-0"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                transition={SPRING_GENTLE}
              >
                <FriendAvatar friend={person} size={SEAT_SIZE} />
                {!readOnly && (
                  // Pressing a person again lets them out: the minus says so before the press.
                  <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-paper-sunken bg-ink text-paper opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Minus className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
        <motion.span
          aria-hidden="true"
          style={{ opacity: labels }}
          className={cn(
            "pointer-events-none absolute left-1/2 top-full mt-1 max-w-[4.25rem] -translate-x-1/2 truncate whitespace-nowrap text-caption font-semibold transition-colors duration-fast",
            on ? "text-ink" : locked ? "text-ink-subtle" : "text-ink-muted",
          )}
        >
          {name}
        </motion.span>
      </motion.div>
    </>
  )
}
