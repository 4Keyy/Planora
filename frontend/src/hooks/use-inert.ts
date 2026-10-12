"use client"

import { useEffect, useLayoutEffect, type RefObject } from "react"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * Makes a subtree inert — out of the tab order, the accessibility tree and the pointer —
 * while `inert` is true.
 *
 * The JSX prop does not do it on React 18. `inert` is a React 19 attribute: React 18
 * warns "Received `true` for a non-boolean attribute" and writes nothing at all, so a
 * folded panel declared `inert={!isOpen}` stayed fully reachable by Tab, every one of its
 * invisible fields a stop. The attribute is written to the node here instead, before the
 * frame is painted.
 */
export function useInert(ref: RefObject<HTMLElement | null>, inert: boolean): void {
  useIsomorphicLayoutEffect(() => {
    ref.current?.toggleAttribute("inert", inert)
  }, [ref, inert])
}
