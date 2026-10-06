"use client"

import { useEffect } from "react"

/**
 * Freezes page scrolling while an overlay is open.
 *
 * Without it a wheel over the backdrop scrolls the page behind the dialog, and on a
 * phone the scroll chains out of the sheet and keeps going — the user closes the
 * dialog to find themselves somewhere else on the page.
 *
 * Three details that are easy to get wrong:
 *
 * 1. **The count, not a boolean.** A confirm dialog opened from inside the category
 *    editor means two overlays are mounted at once. If the inner one released the
 *    lock on close, scrolling would come back while the outer dialog was still up.
 *    The lock lifts when the last holder releases it.
 *
 * 2. **The lock goes on `<html>`, not `<body>`.** The page scrolls on the root:
 *    globals.css gives `<html>` `overflow-y: scroll`, and once the root has an
 *    overflow of its own, `<body>`'s is no longer handed to the viewport. The lock
 *    used to set `overflow: hidden` on `<body>`, which froze nothing (a wheel over
 *    the backdrop still scrolled the page) and turned `<body>` into a scroll
 *    container under every sticky element on the page.
 *
 * 3. **The scrollbar's lane is already kept.** `<html>` also carries
 *    `scrollbar-gutter: stable`, so the lane stays reserved while the root is
 *    `overflow: hidden` and the page keeps its width. The lock used to add the
 *    scrollbar's width as `padding-right` on top of that reserved lane — padding
 *    for space nothing had taken away — and every centred element slid 5px to the
 *    left when a task opened and back when it closed. Only a browser that cannot
 *    reserve the lane gets its width replaced. (It is decided by support, not by
 *    measuring: `clientWidth` reports the empty reserved lane as page width, so a
 *    before/after reading claims a lane was freed when the layout never moved.)
 */

let lockCount = 0

function reservesScrollbarLane(): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("scrollbar-gutter", "stable")
}

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return

    if (lockCount === 0) {
      const root = document.documentElement
      const scrollbarWidth = window.innerWidth - root.clientWidth
      root.style.overflow = "hidden"
      if (scrollbarWidth > 0 && !reservesScrollbarLane()) root.style.paddingRight = `${scrollbarWidth}px`
    }
    lockCount++

    return () => {
      lockCount--
      if (lockCount === 0) {
        const root = document.documentElement
        root.style.overflow = ""
        root.style.paddingRight = ""
      }
    }
  }, [active])
}
