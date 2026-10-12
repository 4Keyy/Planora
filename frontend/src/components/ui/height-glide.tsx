"use client"

import { useRef, type HTMLAttributes, type ReactNode } from "react"
import { useReducedMotion } from "framer-motion"
import { useHeightTransition } from "@/hooks/use-height-transition"
import { SPRING_LAYOUT } from "@/lib/animations"

/**
 * A block whose height glides to whatever it holds, so nothing below it ever jumps — the task
 * grid above the pager, whose cards a new page replaces all at once. `shape` names what it is
 * showing (the page); a change of it holds the page still before anything is measured
 * (`useHeightTransition`). Whatever grows past its bottom edge mid-glide is clipped there,
 * so new cards taller than the old never draw over the pager below.
 */
export function HeightGlide({ shape, children, ...rest }: HTMLAttributes<HTMLDivElement> & { shape?: unknown; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  useHeightTransition(outer, { content: inner, shape, spring: SPRING_LAYOUT, disabled: !!reduce, clipBelow: true })
  return (
    <div {...rest} ref={outer}>
      <div ref={inner}>{children}</div>
    </div>
  )
}
