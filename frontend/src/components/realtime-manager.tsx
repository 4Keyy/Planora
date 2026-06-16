"use client"

import { useNotificationsLifecycle, useRealtimeLifecycle } from "@/lib/realtime/hooks"

/**
 * Headless component that keeps the single SignalR connection open while the user is authenticated
 * and closes it on logout, and drives the notification read-model (unread summary + live pushes).
 * Mounted once at the app root, next to SecurityInitializer.
 */
export function RealtimeManager() {
  useRealtimeLifecycle()
  useNotificationsLifecycle()
  return null
}
