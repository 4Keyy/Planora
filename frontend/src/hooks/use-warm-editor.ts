"use client"

import { useEffect } from "react"
import { loadEditor } from "@/components/todos/edit-todo-modal/lazy"

/**
 * Fetches the task editor ahead of the first open: once the page is idle, or at the first press
 * anywhere on it, whichever comes first. It stays code-split — the First Load payload is
 * unchanged — but the fetch no longer sits between the press and the dialog. A cold first open
 * waited 350–510ms for it (measured, 2026-10-12), and that matters for more than latency: the
 * card-to-dialog transition animates from a rect captured at press time that is discarded as
 * stale after a second (`lib/shared-origin.ts`), so a slow chunk silently cost the first open of a
 * session its transition. A press warms it too, because a press is ~100ms ahead of its click.
 */
export function useWarmEditor(): void {
  useEffect(() => {
    let warmed = false
    const idle = typeof window.requestIdleCallback === "function"
    const stop = () => {
      if (idle) window.cancelIdleCallback?.(handle)
      else window.clearTimeout(handle)
      window.removeEventListener("pointerdown", warm, true)
    }
    const warm = () => {
      if (warmed) return
      warmed = true
      stop()
      void loadEditor().catch(() => {
        // Offline or a deploy in between: the open fetches it again, as it always did.
      })
    }
    const handle = idle ? window.requestIdleCallback(warm, { timeout: 2000 }) : window.setTimeout(warm, 1200)
    window.addEventListener("pointerdown", warm, { capture: true, passive: true })
    return stop
  }, [])
}
