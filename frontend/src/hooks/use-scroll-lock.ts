"use client"

import { useEffect } from "react"

/**
 * Freezes page scrolling while an overlay is open.
 *
 * Without it a wheel over the backdrop scrolls the page behind the dialog, and on a
 * phone the scroll chains out of the sheet and keeps going — the user closes the
 * dialog to find themselves somewhere else on the page.
 *
 * Two details that are easy to get wrong:
 *
 * 1. **The count, not a boolean.** A confirm dialog opened from inside the category
 *    editor means two overlays are mounted at once. If the inner one released the
 *    lock on close, scrolling would come back while the outer dialog was still up.
 *    The lock lifts when the last holder releases it.
 *
 * 2. **The scrollbar's width is replaced as padding.** Setting `overflow: hidden`
 *    removes the scrollbar, the viewport gets ~15px wider, and every centred
 *    element on the page jumps sideways at the exact moment the dialog appears
 *    over it. Adding the width back as right padding holds the layout still.
 *    The gap is zero on overlay-scrollbar platforms (macOS, iOS, Android), so the
 *    padding is only applied when there is one to replace.
 */

let lockCount = 0

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return

    if (lockCount === 0) {
      const { body, documentElement } = document
      const scrollbarWidth = window.innerWidth - documentElement.clientWidth
      body.style.overflow = "hidden"
      if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`
    }
    lockCount++

    return () => {
      lockCount--
      if (lockCount === 0) {
        document.body.style.overflow = ""
        document.body.style.paddingRight = ""
      }
    }
  }, [active])
}
