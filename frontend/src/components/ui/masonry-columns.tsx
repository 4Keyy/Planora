"use client"

import { useEffect, useLayoutEffect, useMemo, useState, useRef, type ReactNode } from "react"
import { AnimatePresence } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { cn } from "@/lib/utils"
import { SPRING_LAYOUT, SPRING_STANDARD, TWEEN_EXIT } from "@/lib/animations"

export type MasonryBreakpoint = { maxWidth: number; columns: number }

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/** 40ms between cards in reading order — the list rhythm of design-system § 9.9. */
const ENTRANCE_STAGGER_S = 0.04

const resolveColumnCount = (width: number, base: number, breakpoints?: MasonryBreakpoint[]) => {
  if (!breakpoints?.length) return base
  const sorted = [...breakpoints].sort((a, b) => a.maxWidth - b.maxWidth)
  for (const bp of sorted) {
    if (width <= bp.maxWidth) return bp.columns
  }
  return base
}

interface MasonryColumnsProps<T> {
  items: T[]
  renderItem: (item: T) => ReactNode
  getKey: (item: T) => string
  className?: string
  gap?: number
  columns?: number
  breakpoints?: MasonryBreakpoint[]
  /** Optional function to estimate the height/weight of an item for balancing columns */
  getItemWeight?: (item: T) => number
}

/** Which column each key sits in, for the column count it was dealt at. */
interface Placement {
  count: number
  column: Map<string, number>
}

/**
 * Columns of cards that stay where they are.
 *
 * Each column is its own parent, and React cannot move a keyed child from one parent to
 * another — a card that changes column unmounts and mounts again. The deal used to be
 * redone from scratch on every change, so creating, completing, hiding or taking one task
 * pushed every later card into a different column: half the grid faded out and rose back
 * in on its entrance stagger, and the removed card, whose exit sat under no presence,
 * vanished in a single frame.
 *
 * Now a card keeps its column for as long as the column count holds. Only cards the grid
 * has not placed yet are dealt — row by row in reading order, each to the shortest column
 * — so a new task lands where there is room and nothing else moves. Inside a column the
 * cards stay in list order, a removed card plays its exit while the ones below glide up
 * (`popLayout` takes it out of the flow at once), and a card that moves up its column
 * glides there. A change of column count re-deals everything from scratch.
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
}: MasonryColumnsProps<T>) {
  const [columnCount, setColumnCount] = useState(baseColumns)
  const prevColumnCountRef = useRef(columnCount)
  const placementRef = useRef<Placement>({ count: 0, column: new Map() })
  // The entrance stagger is for the grid's first paint; a card added later arrives at once.
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
  }, [])

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

  const columnItems = useMemo(() => {
    const cols: T[][] = Array.from({ length: columnCount }, () => [])
    const heights = new Array(columnCount).fill(0)
    const weigh = (item: T) => (getItemWeight ? getItemWeight(item) : 1)
    const previous = placementRef.current.count === columnCount ? placementRef.current.column : null
    const next = new Map<string, number>()
    const fresh: T[] = []

    // Cards already on screen keep their column.
    for (const item of items) {
      const key = getKey(item)
      const col = previous?.get(key)
      if (col === undefined || col >= columnCount) {
        fresh.push(item)
        continue
      }
      cols[col].push(item)
      heights[col] += weigh(item)
      next.set(key, col)
    }

    // The rest are dealt in rows of `columnCount`, each to the shortest column, which keeps
    // a row above the next on a fresh deal and puts a new card where there is room.
    for (let i = 0; i < fresh.length; i += columnCount) {
      for (const item of fresh.slice(i, i + columnCount)) {
        let col = 0
        for (let j = 1; j < columnCount; j++) if (heights[j] < heights[col]) col = j
        cols[col].push(item)
        heights[col] += weigh(item)
        next.set(getKey(item), col)
      }
    }

    // Idempotent under a double render: a second pass finds every key already placed.
    placementRef.current = { count: columnCount, column: next }

    // Inside a column, cards stay in list order — left to right, top to bottom reading.
    const idToIndex = new Map(items.map((item, idx) => [getKey(item), idx]))
    return cols.map((col) =>
      col.sort((a, b) => (idToIndex.get(getKey(a)) ?? 0) - (idToIndex.get(getKey(b)) ?? 0)),
    )
  }, [items, columnCount, getKey, getItemWeight])

  return (
    <div className={cn("flex items-start w-full", className)} style={{ gap: `${gap}px` }}>
      {columnItems.map((colItems, idx) => (
        // `relative`: the offset parent a leaving card is pinned to while it fades.
        <div
          key={`masonry-col-${idx}`}
          className="relative flex flex-col flex-1 min-w-0"
          style={{ gap: `${gap}px` }}
        >
          <AnimatePresence mode="popLayout">
            {colItems.map((item, row) => (
              <motion.div
                layout="position"
                key={getKey(item)}
                className="w-full"
                /* Opacity only: the card inside rises on its own entrance, and two rises
                   stacked (8px here, 15px there) read as a jump rather than a settle. */
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: TWEEN_EXIT }}
                transition={{
                  ...SPRING_STANDARD,
                  /* Stagger across the grid in reading order, capped at eight steps, on
                     the first paint only. Uncapped, the ninth card waited 360ms; after the
                     first paint a new card answers an action and must not wait at all. */
                  delay: mountedRef.current ? 0 : Math.min(row * columnCount + idx, 8) * ENTRANCE_STAGGER_S,
                  /* A card moving to close a gap answers something that just happened:
                     every neighbour moves at once, critically damped so a 300px glide
                     lands without passing its place. */
                  layout: SPRING_LAYOUT,
                }}
              >
                {renderItem(item)}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}
