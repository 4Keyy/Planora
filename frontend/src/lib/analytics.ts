import { getApiBaseUrl } from "@/lib/config"
import { CSRF_HEADER_NAME, getCsrfToken } from "@/lib/csrf"

export const PRODUCT_EVENTS = {
  sessionRestored: "SESSION_RESTORED",
  tokenRefreshFailed: "TOKEN_REFRESH_FAILED",
} as const

export type ProductEventName = (typeof PRODUCT_EVENTS)[keyof typeof PRODUCT_EVENTS]

export const trackProductEvent = (
  eventName: ProductEventName,
  properties?: Record<string, unknown>,
  accessToken?: string,
) => {
  if (typeof window === "undefined") return
  if (!accessToken) return

  void sendProductEvent(eventName, properties, accessToken, new Date().toISOString())
}

/** An event kept for the next session: what happened, when, and whose session it was. */
type PendingProductEvent = {
  eventName: ProductEventName
  properties?: Record<string, unknown>
  occurredAt: string
  userId?: string
}

const PENDING_KEY = "planora:pending-product-events"
const PENDING_MAX = 10

const readPending = (): PendingProductEvent[] => {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "[]")
    return Array.isArray(parsed) ? (parsed as PendingProductEvent[]) : []
  } catch {
    return []
  }
}

const writePending = (events: PendingProductEvent[]) => {
  try {
    if (events.length === 0) sessionStorage.removeItem(PENDING_KEY)
    else sessionStorage.setItem(PENDING_KEY, JSON.stringify(events))
  } catch {
    // Storage full or blocked: the event is lost, as it would have been before.
  }
}

/**
 * An event about a session that has just ended — a refresh that failed. That session's token is
 * the one the API has just rejected, and the analytics endpoint takes signed-in callers only, so
 * sending the event with it was a 401 and the event was lost (or, with no token, never sent). It
 * is kept in this tab (sessionStorage, the ten latest) and sent with the next session's token by
 * `flushQueuedProductEvents`, as of the moment it happened.
 */
export const queueProductEvent = (
  eventName: ProductEventName,
  properties?: Record<string, unknown>,
  userId?: string,
) => {
  if (typeof window === "undefined") return
  const pending = [...readPending(), { eventName, properties, occurredAt: new Date().toISOString(), userId }]
  writePending(pending.slice(-PENDING_MAX))
}

/**
 * Sends what an ended session left behind, now that `accessToken` works — called when a session
 * starts or renews. Only the same person's events go: one left by someone else signed in on this
 * tab is dropped rather than recorded under the wrong account; one whose session was unknown goes
 * with this one.
 */
export const flushQueuedProductEvents = (accessToken: string, userId?: string) => {
  if (typeof window === "undefined") return
  const pending = readPending()
  writePending([])
  for (const event of pending) {
    if (event.userId && userId && event.userId.toLowerCase() !== userId.toLowerCase()) continue
    void sendProductEvent(event.eventName, event.properties, accessToken, event.occurredAt)
  }
}

const sendProductEvent = async (
  eventName: ProductEventName,
  properties: Record<string, unknown> | undefined,
  accessToken: string,
  occurredAt: string,
) => {
  try {
    const csrfToken = await getCsrfToken()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [CSRF_HEADER_NAME]: csrfToken,
      Authorization: `Bearer ${accessToken}`,
    }

    await fetch(`${getApiBaseUrl()}/auth/api/v1/analytics/events`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        eventName,
        properties,
        occurredAt,
      }),
    })
  } catch {
    // Analytics must never affect product flows.
  }
}
