// Cross-tab auth signalling primitives. Kept in their own module so the store
// and the initializer share the channel name without one importing the other.

export const AUTH_BROADCAST_CHANNEL = "planora-auth"
export const AUTH_BROADCAST_LOGOUT = "logout"

type LogoutMessage = { type: typeof AUTH_BROADCAST_LOGOUT }

/**
 * Best-effort cross-tab logout signal. No-ops when BroadcastChannel is
 * unavailable (very old browsers, some embedded webviews) or when running
 * during SSR — every caller is in a browser-only code path anyway.
 */
export function broadcastLogout(): void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return
  }
  try {
    const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL)
    const message: LogoutMessage = { type: AUTH_BROADCAST_LOGOUT }
    channel.postMessage(message)
    channel.close()
  } catch {
    // BroadcastChannel can throw in cross-origin iframes; logout is best-effort
    // so we swallow rather than surface a failure to the auth flow.
  }
}
