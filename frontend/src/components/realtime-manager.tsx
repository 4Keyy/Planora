"use client"

import { useNotificationsLifecycle, useRealtimeLifecycle } from "@/lib/realtime/hooks"

/**
 * Headless component that keeps the single SignalR connection open while the user is authenticated
 * and closes it on logout, and drives the notification read-model (unread summary + live pushes).
 * Mounted once at the app root, next to SecurityInitializer.
 *
 * The landing page's sandbox opts out of both, and it does so inside the hooks rather
 * than here — see `lib/realtime/hooks.ts`. A guard in this component's render would be
 * evaluated once, before the sandbox has seeded anything, and never again.
 */
export function RealtimeManager() {
  useRealtimeLifecycle()
  useNotificationsLifecycle()
  return null
}
