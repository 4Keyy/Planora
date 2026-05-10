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

function smoothScrollToTop(duration = 650, onComplete?: () => void) {
  const start = window.scrollY
  if (start === 0) {
    onComplete?.()
    return
  }

  const startTime = performance.now()
  function step(now: number) {
    const elapsed = now - startTime
    const t = Math.min(elapsed / duration, 1)
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    window.scrollTo(0, Math.max(0, start * (1 - ease)))
    if (t < 1) {
      requestAnimationFrame(step)
    } else {
      onComplete?.()
    }
  }
  requestAnimationFrame(step)
}

export function useCollapseScroll(isOpen: boolean) {
  const wasOpen = useRef(isOpen)
  const isHeightLocked = useRef(false)
  const lockSnapshot = useRef<ScrollLockSnapshot | null>(null)

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

      smoothScrollToTop(650, () => {
        unlockDocumentHeight(lockSnapshot.current)
        lockSnapshot.current = null
        isHeightLocked.current = false
      })
    }
  }, [isOpen])

  useEffect(() => {
    return () => {
      if (isHeightLocked.current) {
        unlockDocumentHeight(lockSnapshot.current)
        lockSnapshot.current = null
        isHeightLocked.current = false
      }
    }
  }, [])

  return prepareCollapseScroll
}
