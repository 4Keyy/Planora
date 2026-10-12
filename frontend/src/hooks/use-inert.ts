"use client"

import { useEffect, useLayoutEffect, type RefObject } from "react"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * Makes a subtree inert — out of the tab order, the accessibility tree and the pointer —
 * while `inert` is true.
 *
 * Written to the node rather than passed as the JSX prop, so it holds under both Reacts this
 * code runs on. The App Router renders with the React 19 that Next.js ships, where the prop
 * works; the unit tests render with the React 18 in `package.json`, which warns "Received
 * `true` for a non-boolean attribute" and writes nothing — a folded panel tested there would
 * look reachable by Tab when it is not, or the other way round. The attribute is written
 * before the frame is painted.
 */
export function useInert(ref: RefObject<HTMLElement | null>, inert: boolean): void {
  useIsomorphicLayoutEffect(() => {
    ref.current?.toggleAttribute("inert", inert)
  }, [ref, inert])
}
