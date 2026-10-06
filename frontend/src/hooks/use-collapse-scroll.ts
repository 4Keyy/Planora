import { useCallback, useEffect, useRef } from "react"

type ScrollLockSnapshot = {
  htmlOverflowAnchor: string
  htmlScrollBehavior: string
  bodyMinHeight: string
}

function lockDocumentHeight(): ScrollLockSnapshot {
  const html = document.documentElement
  const body = document.body
  const snapshot = {
    htmlOverflowAnchor: html.style.overflowAnchor,
    htmlScrollBehavior: html.style.scrollBehavior,
    bodyMinHeight: body.style.minHeight,
  }
  const lockedHeight = Math.max(body.scrollHeight, html.scrollHeight, window.scrollY + window.innerHeight)

  html.style.overflowAnchor = "none"
  html.style.scrollBehavior = "auto"
  body.style.minHeight = `${lockedHeight}px`

  return snapshot
}

function unlockDocumentHeight(snapshot: ScrollLockSnapshot | null) {
  document.documentElement.style.overflowAnchor = snapshot?.htmlOverflowAnchor ?? ""
  document.documentElement.style.scrollBehavior = snapshot?.htmlScrollBehavior ?? ""
  document.body.style.minHeight = snapshot?.bodyMinHeight ?? ""
}

/** The reader's own scroll input. While the page glides to the top, any of these hands it back. */
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Glides the page to the top and calls `onComplete` when it is there — or when the glide
 * stops early. Returns a cancel function.
 *
 * Three ways it stops early, each of which once left the page fighting the reader:
 * - **Reduced motion.** A rAF loop is reached by neither the CSS media block nor
 *   framer-motion's MotionConfig, so it reads the preference itself and jumps instead.
 * - **The reader scrolls.** A wheel, touch, key or pointer press during the 650ms is the
 *   reader taking the page back; the loop used to drag it to the top regardless.
 * - **Unmount.** The caller cancels, so no frame writes to a page that has moved on.
 */
function smoothScrollToTop(duration = 650, onComplete?: () => void): () => void {
  const start = window.scrollY
  if (start === 0 || prefersReducedMotion()) {
    if (start !== 0) window.scrollTo(0, 0)
    onComplete?.()
    return () => {}
  }

  let frame = 0
  let done = false
  const finish = () => {
    if (done) return
    done = true
    cancelAnimationFrame(frame)
    for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, finish)
    onComplete?.()
  }
  for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, finish, { passive: true })

  const startTime = performance.now()
  function step(now: number) {
    if (done) return
    const elapsed = now - startTime
    const t = Math.min(elapsed / duration, 1)
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    window.scrollTo(0, Math.max(0, start * (1 - ease)))
    if (t < 1) {
      frame = requestAnimationFrame(step)
    } else {
      finish()
    }
  }
  frame = requestAnimationFrame(step)
  return finish
}

export function useCollapseScroll(isOpen: boolean) {
  const wasOpen = useRef(isOpen)
  const isHeightLocked = useRef(false)
  const lockSnapshot = useRef<ScrollLockSnapshot | null>(null)
  const cancelGlide = useRef<(() => void) | null>(null)

  const prepareCollapseScroll = useCallback(() => {
    if (typeof window === "undefined" || window.scrollY <= 0 || isHeightLocked.current) return
    lockSnapshot.current = lockDocumentHeight()
    isHeightLocked.current = true
  }, [])

  useEffect(() => {
    const justClosed = wasOpen.current && !isOpen
    wasOpen.current = isOpen

    if (justClosed && window.scrollY > 0) {
      if (!isHeightLocked.current) {
        lockSnapshot.current = lockDocumentHeight()
        isHeightLocked.current = true
      }

      cancelGlide.current = smoothScrollToTop(650, () => {
        cancelGlide.current = null
        unlockDocumentHeight(lockSnapshot.current)
        lockSnapshot.current = null
        isHeightLocked.current = false
      })
    }
  }, [isOpen])

  useEffect(() => {
    return () => {
      // Stop the glide first: its completion unlocks the height, and a frame after unmount
      // would otherwise keep writing scroll positions to whatever page came next.
      cancelGlide.current?.()
      if (isHeightLocked.current) {
        unlockDocumentHeight(lockSnapshot.current)
        lockSnapshot.current = null
        isHeightLocked.current = false
      }
    }
  }, [])

  return prepareCollapseScroll
}
