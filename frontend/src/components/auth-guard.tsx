"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const hasRestoredSession = useAuthStore((s) => s.hasRestoredSession)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    if (!hasHydrated || !hasRestoredSession) return
    if (!isAuthenticated) {
      router.replace("/auth/login")
    }
  }, [hasHydrated, hasRestoredSession, isAuthenticated, router])

  // Show nothing while hydrating or while the silent refresh is in flight
  if (!hasHydrated || !hasRestoredSession) return null

  // Redirect is in flight — render nothing to avoid flash of protected content
  if (!isAuthenticated) return null

  return <>{children}</>
}
