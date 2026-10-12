"use client"

import { useEffect, useRef, type RefObject } from "react"
import { registerPriorityTarget, type PriorityKeyTarget } from "@/lib/priority-keys"

/**
 * Lets a card take the number keys while the pointer rests on it (`lib/priority-keys.ts`).
 *
 * Registered once per node, for as long as the node lives: what the card accepts and what
 * a key does are read through a ref when the key lands, so a card re-rendering for its
 * own reasons never re-registers, and a key never acts on a render that is already gone.
 */
export function usePriorityTarget(ref: RefObject<Element | null>, target: PriorityKeyTarget): void {
  const latest = useRef(target)
  latest.current = target

  useEffect(() => {
    const node = ref.current
    if (!node) return
    return registerPriorityTarget(node, {
      accepts: (level) => latest.current.accepts(level),
      apply: (level) => latest.current.apply(level),
    })
  }, [ref])
}
