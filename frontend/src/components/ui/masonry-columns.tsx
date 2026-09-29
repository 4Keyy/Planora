"use client"

import { useEffect, useLayoutEffect, useMemo, useState, useRef, type ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { SPRING_STANDARD } from "@/lib/animations"

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
    
    // We process items in chunks (rows). This is the "Smart Row" approach.
    // It guarantees that items in Row 1 are always above items in Row 2,
    // and within a row, they are distributed to balance heights.
    for (let i = 0; i < items.length; i += columnCount) {
      const rowItems = items.slice(i, i + columnCount)
      
      // For each item in the current "row", pick the shortest column
      rowItems.forEach((item) => {
        let minHeight = heights[0]
        let colIndex = 0
        for (let j = 1; j < columnCount; j++) {
          if (heights[j] < minHeight) {
            minHeight = heights[j]
            colIndex = j
          }
        }

        cols[colIndex].push(item)
        const weight = getItemWeight ? getItemWeight(item) : 1
        heights[colIndex] += weight
      })
    }

    // Step 3: Crucial for left-to-right reading flow.
    // Within each column, items MUST be in their original sorted order.
    const idToIndex = new Map(items.map((item, idx) => [getKey(item), idx]))
    
    return cols.map(col => 
      [...col].sort((a, b) => (idToIndex.get(getKey(a)) ?? 0) - (idToIndex.get(getKey(b)) ?? 0))
    )
  }, [items, columnCount, getKey, getItemWeight])

  return (
    <div className={cn("flex items-start w-full", className)} style={{ gap: `${gap}px` }}>
      <AnimatePresence mode="popLayout">
        {columnItems.map((colItems, idx) => (
          <motion.div
            layout
            key={`masonry-col-${idx}`}
            transition={SPRING_STANDARD}
            className="flex flex-col flex-1 min-w-0"
            style={{ gap: `${gap}px` }}
          >
            {colItems.map((item, row) => (
              <motion.div
                layout
                key={getKey(item)}
                className="w-full"
                /* `y`, not `scale`. A card that scales up reads as a popup; a card
                   that rises into place reads as a list settling, which is what this
                   is. 8px is enough to see and small enough not to look like travel. */
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{
                  ...SPRING_STANDARD,
                  /* Stagger across the grid in reading order, capped at eight steps.
                     Uncapped, the ninth card waits 360ms and the twentieth waits most
                     of a second — the stagger stops being rhythm and becomes lag. */
                  delay: Math.min(row * columnCount + idx, 8) * ENTRANCE_STAGGER_S,
                  /* The stagger is for arriving. A card moving to close a gap answers
                     something that just happened, so every neighbour moves at once —
                     inheriting the delay made the ninth card start 320ms late. */
                  layout: SPRING_STANDARD,
                }}
              >
                {renderItem(item)}
              </motion.div>
            ))}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
