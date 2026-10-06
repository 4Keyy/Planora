"use client"

import { useEffect, useRef, type RefObject } from "react"

/** Close via the owner's normal state transition so its exit animation can finish. */
export function useDismissHiddenAnchor(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null> | undefined,
  onClose: () => void,
) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const anchor = anchorRef?.current
    if (!open || !anchor || typeof IntersectionObserver === "undefined") return
    // IntersectionObserver includes clipping by nested scroll containers, not just window scroll.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.target === anchor && (!entry.isIntersecting || entry.intersectionRatio === 0))) {
        closeRef.current()
      }
    }, { threshold: 0 })
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [open, anchorRef])
}
