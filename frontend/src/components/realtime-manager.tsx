"use client"

import { useRealtimeLifecycle } from "@/lib/realtime/hooks"

/**
 * Headless component that keeps the single SignalR connection open while the user is authenticated
 * and closes it on logout. Mounted once at the app root, next to SecurityInitializer.
 */
export function RealtimeManager() {
  useRealtimeLifecycle()
  return null
}
