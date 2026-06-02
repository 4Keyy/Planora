"use client"

import { useEffect } from "react"
import { getCsrfToken } from "@/lib/csrf"
import { useAuthStore } from "@/store/auth"
import { api, parseApiResponse } from "@/lib/api"
import { AUTH_BROADCAST_CHANNEL, AUTH_BROADCAST_LOGOUT } from "@/lib/auth-broadcast"
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

  // Cross-tab logout broadcast. The store persists to sessionStorage (per-tab),
  // so the native `storage` event will not fire across tabs. BroadcastChannel
  // is the right primitive: when one tab calls clearAuth() (manual logout, 401
  // chain expired, scheduled-refresh failure), it posts a logout message; every
  // other tab drops its in-memory access token without a network round-trip.
  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
      return
    }
    const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === AUTH_BROADCAST_LOGOUT) {
        // _silent=true prevents a rebroadcast loop: the receiving tab clears
        // local state but does not re-publish the same logout message.
        useAuthStore.getState().clearAuth(true)
      }
    }
    return () => channel.close()
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
