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

  void sendProductEvent(eventName, properties, accessToken)
}

const sendProductEvent = async (
  eventName: ProductEventName,
  properties?: Record<string, unknown>,
  accessToken?: string,
) => {
  try {
    const csrfToken = await getCsrfToken()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [CSRF_HEADER_NAME]: csrfToken,
    }

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`
    }

    await fetch(`${getApiBaseUrl()}/auth/api/v1/analytics/events`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        eventName,
        properties,
        occurredAt: new Date().toISOString(),
      }),
    })
  } catch {
    // Analytics must never affect product flows.
  }
}
