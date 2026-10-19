"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { AnimatePresence, animate, motionValue, useReducedMotion, type MotionValue } from "framer-motion"
import { ArrivalHandled, useEnter } from "@/components/animated/entrance"
import { motion } from "@/components/ui/motion"
import { cn } from "@/lib/utils"
import { SPRING_LAYOUT, SPRING_STANDARD, TWEEN_EXIT } from "@/lib/animations"

export type MasonryBreakpoint = { maxWidth: number; columns: number }

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/** 40ms between cards in reading order — the list rhythm of design-system § 9.9. */
const ENTRANCE_STAGGER_S = 0.04
/** Two columns this close are as short as each other: the left one takes the next card. */
const TIE_PX = 0.5
/** How long a card's height must hold still before the grid re-deals around it. */
const SETTLE_MS = 180

const resolveColumnCount = (width: number, base: number, breakpoints?: MasonryBreakpoint[]) => {
  if (!breakpoints?.length) return base
  const sorted = [...breakpoints].sort((a, b) => a.maxWidth - b.maxWidth)
  for (const bp of sorted) {
    if (width <= bp.maxWidth) return bp.columns
  }
  return base
}

export interface DealtCard {
  column: number
  /** px from the grid's top. */
  top: number
}

/**
 * Deals cards, in list order, each to the shortest column — the leftmost of equally short ones.
 *
 * The column a card goes to is the one whose bottom is highest, so every card starts no higher
 * than the one before it: reading the grid left to right and top to bottom reads the list in
 * its order, and a column is never left empty while one to its right has cards. A card's place
 * depends only on the cards before it, so a change near the end of the list moves nothing above.
 */
export function dealColumns(
  heights: readonly number[],
  columns: number,
  gap: number,
): { cards: DealtCard[]; height: number } {
  const count = Math.max(1, Math.floor(columns))
  const bottoms = new Array<number>(count).fill(0)
  const cards = heights.map((h) => {
    let column = 0
    for (let j = 1; j < count; j++) if (bottoms[j] < bottoms[column] - TIE_PX) column = j
    const top = bottoms[column]
    bottoms[column] = top + Math.max(0, h) + gap
    return { column, top }
  })
  return { cards, height: cards.length === 0 ? 0 : Math.max(...bottoms) - gap }
}

interface MasonryColumnsProps<T> {
  items: T[]
  renderItem: (item: T) => ReactNode
  getKey: (item: T) => string
  className?: string
  gap?: number
  columns?: number
  breakpoints?: MasonryBreakpoint[]
  /** A card's height before it has been measured, in px — only ever needed for an instant. */
  getItemWeight?: (item: T) => number
  /**
   * On a page's timeline: when the grid's first card arrives. The first paint's cards rise
   * in from there in reading order, a card's beat apart; a card added later arrives at once.
   * Without it (or off a timeline) the grid fades its cards in itself.
   */
  entranceAt?: number
  /**
   * What the grid is dealing — the page of a paged list. A new deal is a fresh hand: its cards
   * arrive in reading order, a beat apart, as the first paint's do, rather than all at once
   * like a card added to the hand already on the table.
   */
  deal?: unknown
  /**
   * The grid glides its own height to what it holds (the default), so whatever is below it
   * rides along with the cards. Off inside a `HeightGlide`, which glides it already.
   */
  glideHeight?: boolean
}

type Glide = "glide" | "follow" | "jump"

/** A card's place on the compositor, and where it is heading. */
interface Place {
  x: MotionValue<number>
  y: MotionValue<number>
  tx: number
  ty: number
  /** Painted at a place at least once: from now on it travels instead of appearing. */
  placed: boolean
}

/**
 * The task grid: cards in columns, dealt in list order, that travel instead of jumping.
 *
 * Every card is a child of one box and is placed on it by a transform — a column is a place,
 * not a parent. The columns used to be parents, and React cannot move a child from one parent
 * to another: a card changing column unmounted and mounted again, and its entrance played. So
 * the grid kept every card in the column it was first dealt to. After a filter it showed an
 * empty column between two full ones, and the order across columns stopped being the list's:
 * a card new at the top of the list went wherever there was room.
 *
 * Now nothing has to stay put to stay mounted:
 *
 * - **A fresh deal on every change** of the list or of the column count (`dealColumns`, on
 *   the cards' measured heights): the order is always the list's, the columns always as even
 *   as that order allows, and never an empty column between full ones.
 * - **Every move is a glide** on one critically damped spring (`SPRING_LAYOUT`), started from
 *   the speed the card already has — so changes in quick succession, a filter toggled on and
 *   off, bend one path instead of starting a new one. A card that leaves fades where it is;
 *   one that comes back while still leaving turns round and travels to its new place.
 * - **A card that changes height** (opened from hidden, its content arriving) pushes the ones
 *   below it in its column in step, frame by frame, and once it has held still the grid
 *   re-deals around it, gliding, if the order across columns needs it.
 * - **Tab and screen readers** meet the cards in list order — the DOM is the list.
 *
 * The first paint (and the server's) lays the cards out as a plain CSS grid, row by row; they
 * are measured before anything is painted and placed from then on.
 */
export function MasonryColumns<T>({
  items,
  renderItem,
  getKey,
  className,
  gap = 16,
  columns: baseColumns = 4,
  breakpoints,
  getItemWeight,
  entranceAt,
  deal,
  glideHeight = true,
}: MasonryColumnsProps<T>) {
  const reduce = useReducedMotion() ?? false
  const [columnCount, setColumnCount] = useState(baseColumns)
  const prevColumnCountRef = useRef(columnCount)
  // False until the first layout effect: the server's paint and the first client render are a
  // CSS grid; the cards are placed from the next render, before the browser paints.
  const [measured, setMeasured] = useState(false)

  const boxRef = useRef<HTMLDivElement>(null)
  const nodes = useRef(new Map<string, HTMLElement>())
  const keyOfNode = useRef(new WeakMap<Element, string>())
  const heights = useRef(new Map<string, number>())
  const places = useRef(new Map<string, Place>())
  const columnOf = useRef(new Map<string, number>())
  const boxHeight = useRef(motionValue(0)).current
  const boxWidth = useRef(0)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const observer = useRef<ResizeObserver | null>(null)

  // What the async callbacks (the observer, the settle timer) read: always this render's.
  const keys = items.map(getKey)
  const live = useRef({ keys, columnCount, gap, reduce, glideHeight, estimate: (_key: string): number => 0 })
  live.current = {
    keys,
    columnCount,
    gap,
    reduce,
    glideHeight,
    estimate: (key: string) => {
      const item = items.find((it) => getKey(it) === key)
      return item && getItemWeight ? getItemWeight(item) : 0
    },
  }

  // The entrance stagger is for the grid's first paint and for a new deal; a card added to the
  // hand on the table arrives at once.
  const mountedRef = useRef(false)
  const dealtRef = useRef(deal)
  const freshDeal = !Object.is(dealtRef.current, deal)
  useEffect(() => {
    mountedRef.current = true
    dealtRef.current = deal
  })

  /*
   * A layout effect, not an effect: the count has to be right before the first paint.
   * With `useEffect` the grid painted with the base count and re-flowed a frame later — at
   * 768px three columns became two and every card moved, a layout shift on every visit.
   * On the server this is a plain effect (React warns about layout effects there).
   */
  useIsomorphicLayoutEffect(() => {
    const update = () => {
      const newCount = resolveColumnCount(window.innerWidth, baseColumns, breakpoints)
      if (newCount !== prevColumnCountRef.current) {
        prevColumnCountRef.current = newCount
        setColumnCount(newCount)
      }
    }
    update()
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("resize", update)
    }
  }, [baseColumns, breakpoints])

  const placeOf = (key: string): Place => {
    let place = places.current.get(key)
    if (!place) {
      place = { x: motionValue(0), y: motionValue(0), tx: 0, ty: 0, placed: false }
      places.current.set(key, place)
    }
    return place
  }

  /** Moves one value: at once (written to the node too, so this frame paints it) or on the spring. */
  const moveValue = (value: MotionValue<number>, to: number, how: Glide, write: () => void) => {
    if (how === "jump" || (how === "follow" && !value.isAnimating())) {
      value.jump(to)
      write()
      return
    }
    // Retargeted from where it is and how fast it is going: one path, however often it turns.
    animate(value, to, SPRING_LAYOUT)
  }

  /**
   * Places every card. `deal` re-deals from scratch; `restack` keeps each card in its column and
   * only closes the column up under a card whose height changed. `how` is how the cards get
   * there: gliding, following (in step with a card's own height glide) or at once.
   */
  const layout = useCallback((mode: "deal" | "restack", how: Glide) => {
    const box = boxRef.current
    if (!box) return
    const { keys: order, columnCount: count, gap: space, reduce: still, glideHeight: glides, estimate } = live.current
    const width = box.clientWidth
    boxWidth.current = width
    const columnWidth = (width - space * (count - 1)) / count
    const heightOf = (key: string) => heights.current.get(key) ?? estimate(key)

    let dealt: DealtCard[]
    let total: number
    if (mode === "deal") {
      ;({ cards: dealt, height: total } = dealColumns(order.map(heightOf), count, space))
    } else {
      const bottoms = new Array<number>(count).fill(0)
      dealt = order.map((key) => {
        const kept = columnOf.current.get(key)
        let column = kept !== undefined && kept < count ? kept : 0
        if (kept === undefined || kept >= count) {
          for (let j = 1; j < count; j++) if (bottoms[j] < bottoms[column] - TIE_PX) column = j
        }
        const top = bottoms[column]
        bottoms[column] = top + heightOf(key) + space
        return { column, top }
      })
      total = dealt.length === 0 ? 0 : Math.max(...bottoms) - space
    }

    const next = new Map<string, number>()
    order.forEach((key, i) => {
      const { column, top } = dealt[i]
      next.set(key, column)
      const place = placeOf(key)
      const x = column * (columnWidth + space)
      const y = top
      // A card that has never been painted appears at its place; so does everything, reduced.
      // Following, a card that has to change column still glides there: it never skips.
      const moved = columnOf.current.get(key) !== undefined && columnOf.current.get(key) !== column
      const way: Glide = !place.placed || still ? "jump" : how === "follow" && moved ? "glide" : how
      const node = nodes.current.get(key)
      const write = () => {
        if (node) node.style.transform = `translateX(${place.x.get()}px) translateY(${place.y.get()}px)`
      }
      if (place.tx !== x || way === "jump") moveValue(place.x, x, way, write)
      if (place.ty !== y || way === "jump") moveValue(place.y, y, way, write)
      place.tx = x
      place.ty = y
      place.placed = place.placed || node !== undefined
      // Where it was dealt, for whoever reads the grid from outside (tests, layout probes).
      if (node && node.dataset.column !== String(column)) node.dataset.column = String(column)
    })
    columnOf.current = next

    const boxNode = boxRef.current
    const writeBox = () => {
      if (boxNode) boxNode.style.height = `${boxHeight.get()}px`
    }
    moveValue(boxHeight, total, glides && !still ? how : "jump", writeBox)
    // Everything else it reads is a ref or `live`, this render's values.
  }, [boxHeight])

  /* One observer for the box (its width) and every card (its height). */
  useIsomorphicLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver((entries) => {
      let widthChanged = false
      let heightChanged = false
      for (const entry of entries) {
        if (entry.target === boxRef.current) {
          if (Math.abs(boxRef.current.clientWidth - boxWidth.current) > 0.5) widthChanged = true
          continue
        }
        const key = keyOfNode.current.get(entry.target)
        if (key === undefined || !nodes.current.has(key)) continue
        const h = (entry.target as HTMLElement).offsetHeight
        if (Math.abs((heights.current.get(key) ?? -1) - h) > 0.5) {
          heights.current.set(key, h)
          heightChanged = true
        }
      }
      if (widthChanged) {
        // A narrower or wider page: the cards follow it at once, as the page does — except those
        // already on their way somewhere (a scrollbar coming or going mid-glide), which turn.
        for (const [key, node] of nodes.current) heights.current.set(key, node.offsetHeight)
        layout("deal", "follow")
        return
      }
      if (!heightChanged) return
      layout("restack", "follow")
      if (settleTimer.current) clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null
        layout("deal", "glide")
      }, SETTLE_MS)
    })
    observer.current = ro
    if (boxRef.current) ro.observe(boxRef.current)
    for (const node of nodes.current.values()) ro.observe(node)
    return () => {
      ro.disconnect()
      observer.current = null
      if (settleTimer.current) clearTimeout(settleTimer.current)
      settleTimer.current = null
    }
  }, [layout])

  const register = useCallback((key: string, node: HTMLElement | null) => {
    const previous = nodes.current.get(key)
    if (node) {
      if (previous === node) return
      if (previous) observer.current?.unobserve(previous)
      nodes.current.set(key, node)
      keyOfNode.current.set(node, key)
      observer.current?.observe(node)
      return
    }
    // Its place is kept: under React 19's strict mode a ref is let go and taken again on mount,
    // and the element still moves on the motion values it rendered with. Places of cards that
    // are gone for good are dropped after the next deal.
    if (previous) observer.current?.unobserve(previous)
    nodes.current.delete(key)
    heights.current.delete(key)
  }, [])

  // Deal whenever the list or the column count changes — measured, before the browser paints.
  const signature = `${measured ? 1 : 0}|${columnCount}|${keys.join("\u0000")}`
  const laidOut = useRef(false)
  useIsomorphicLayoutEffect(() => {
    if (!measured) {
      setMeasured(true)
      return
    }
    for (const key of keys) {
      const node = nodes.current.get(key)
      if (node && !heights.current.has(key)) heights.current.set(key, node.offsetHeight)
    }
    layout("deal", laidOut.current ? "glide" : "jump")
    laidOut.current = true
    const listed = new Set(keys)
    for (const key of places.current.keys()) {
      if (!listed.has(key) && !nodes.current.has(key)) {
        places.current.delete(key)
        columnOf.current.delete(key)
      }
    }
    // `keys` is read through `signature`.
  }, [signature, layout])

  const columnWidth = `calc((100% - ${gap * (columnCount - 1)}px) / ${columnCount})`
  const boxStyle: CSSProperties = measured
    ? { position: "relative" }
    : { display: "grid", gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`, gap: `${gap}px`, alignItems: "start" }

  return (
    <motion.div ref={boxRef} className={cn("w-full", className)} style={measured ? { ...boxStyle, height: boxHeight } : boxStyle}>
      <AnimatePresence initial>
        {items.map((item, index) => {
          const key = keys[index]
          const place = placeOf(key)
          return (
            <MasonryItem
              key={key}
              id={key}
              register={register}
              x={place.x}
              y={place.y}
              width={measured ? columnWidth : undefined}
              // Reading order across the grid, on the first paint and a new deal only: after
              // them a new card answers an action and must not wait for its place in a cascade.
              order={mountedRef.current && !freshDeal ? 0 : index}
              entranceAt={entranceAt}
            >
              {renderItem(item)}
            </MasonryItem>
          )
        })}
      </AnimatePresence>
    </motion.div>
  )
}

interface MasonryItemProps {
  id: string
  register: (key: string, node: HTMLElement | null) => void
  x: MotionValue<number>
  y: MotionValue<number>
  /** Placed on the box (absolute, at x/y) once measured; in the CSS grid's flow before. */
  width?: string
  order: number
  entranceAt?: number
  children: ReactNode
}

/**
 * One card's place: where it is on the box (a transform, on the compositor), its presence — the
 * fade where it stands as it leaves — and, on a page's timeline, its arrival: rising in as a
 * card from the grid's moment plus its place in reading order. The card inside is told its
 * arrival is handled, so it does not rise a second time on its own entrance.
 */
const MasonryItem = forwardRef<HTMLDivElement, MasonryItemProps>(function MasonryItem(
  { id, register, x, y, width, order, entranceAt, children },
  forwarded,
) {
  const entrance = useEnter("card", { at: entranceAt ?? 0, index: order })
  const arrives = entranceAt !== undefined && entrance.className !== undefined
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      register(id, node)
      if (typeof forwarded === "function") forwarded(node)
      else if (forwarded) forwarded.current = node
    },
    [id, register, forwarded],
  )
  return (
    <motion.div
      ref={ref}
      data-masonry-card=""
      // Above its neighbours while pointed at or focused: its glow is never drawn under theirs.
      className="left-0 top-0 hover:z-10 focus-within:z-10"
      style={{ x, y, position: width ? "absolute" : "relative", width }}
      /* Off a timeline: opacity only — the card inside rises on its own entrance, and two
         rises stacked (8px here, 15px there) read as a jump rather than a settle. */
      initial={arrives ? false : { opacity: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: TWEEN_EXIT }}
      transition={{
        ...SPRING_STANDARD,
        /* Stagger across the grid in reading order, capped at eight steps. Uncapped, the
           ninth card waited 360ms. */
        delay: arrives ? 0 : Math.min(order, 8) * ENTRANCE_STAGGER_S,
        // A card turning back while it was leaving grows back to its size without a bounce.
        scale: SPRING_LAYOUT,
      }}
    >
      <div className={cn(arrives && entrance.className)} style={arrives ? entrance.style : undefined}>
        {arrives ? <ArrivalHandled>{children}</ArrivalHandled> : children}
      </div>
    </motion.div>
  )
})
