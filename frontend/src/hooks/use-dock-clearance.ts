"use client"

import { useEffect, type RefObject } from "react"

/**
 * How much of the bottom of the screen a docked control is holding — quick capture's
 * bubble, the selection bar — published as `--pl-dock-clearance` on the document, so the
 * notice stack (`Toaster`) can rise above whatever sits there instead of covering it.
 *
 * Each dock registers its fixed strip; the variable is the tallest one's height, or 0px
 * when none shows anything (a strip whose content is hidden — the capture bubble above
 * `sm` — holds nothing and counts for nothing).
 */
const docks = new Map<symbol, number>()

function publish(): void {
  if (typeof document === "undefined") return
  const tallest = Math.max(0, ...docks.values())
  document.documentElement.style.setProperty("--pl-dock-clearance", `${Math.ceil(tallest)}px`)
}

function held(strip: HTMLElement): number {
  const style = getComputedStyle(strip)
  const content = strip.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  return content >= 1 ? strip.offsetHeight : 0
}

export function useDockClearance(strip: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const element = strip.current
    if (!element || !active) return
    const key = Symbol("dock")
    const measure = () => {
      docks.set(key, held(element))
      publish()
    }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(element)
    // A breakpoint can hide the content without resizing the strip's own box.
    window.addEventListener("resize", measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", measure)
      docks.delete(key)
      publish()
    }
  }, [strip, active])
}
