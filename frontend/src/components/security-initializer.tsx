"use client"

import { useEffect } from "react"
import { getCsrfToken } from "@/lib/csrf"
import { useAuthStore } from "@/store/auth"

export function SecurityInitializer() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated)

  // Phase 1: Fetch CSRF token immediately (does not depend on hydration)
  useEffect(() => {
    getCsrfToken().catch((err) => {
      console.warn("[Security] CSRF token initialization failed:", err)
    })
  }, [])

  // Phase 2: Restore session ONLY after Zustand has rehydrated from sessionStorage.
  // Without this guard, restoreSession runs before refreshTokenExpiresAt is loaded,
  // isRefreshTokenValid() returns false, and clearAuth() is called → F5 logout.
  useEffect(() => {
    if (!hasHydrated) return

    const { restoreSession, scheduleTokenRefresh } = useAuthStore.getState()

    let cleanup: (() => void) | undefined

    const run = async () => {
      try {
        await restoreSession()
        cleanup = scheduleTokenRefresh()
      } catch {
        // Expected when not logged in
      }
    }

    run()

    return () => {
      cleanup?.()
    }
  }, [hasHydrated])

  return null
}
