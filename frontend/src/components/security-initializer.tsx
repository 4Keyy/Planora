"use client"

import { useEffect } from "react"
import { getCsrfToken } from "@/lib/csrf"
import { useAuthStore } from "@/store/auth"
import { api, parseApiResponse } from "@/lib/api"
import type { UserDto } from "@/types/auth"

export function SecurityInitializer() {
  const hasHydrated    = useAuthStore((s) => s.hasHydrated)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

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

  // Phase 3: Hydrate profilePictureUrl whenever the user becomes authenticated.
  // The JWT does not carry the avatar URL, so after every login or session
  // restore the store has no avatar. We fetch /users/me once per authentication
  // event and patch only the missing field — no re-render storm, non-fatal.
  useEffect(() => {
    if (!isAuthenticated) return

    const state = useAuthStore.getState()
    if (state.user?.profilePictureUrl) return   // already populated — skip

    const fetchAvatar = async () => {
      try {
        const res  = await api.get("/auth/api/v1/users/me")
        const data = parseApiResponse<UserDto>(res.data)
        if (data?.profilePictureUrl !== undefined) {
          useAuthStore.getState().updateUser({ profilePictureUrl: data.profilePictureUrl })
        }
      } catch {
        // Non-fatal: avatar will load lazily when the user visits /profile
      }
    }

    fetchAvatar()
  }, [isAuthenticated])

  return null
}
