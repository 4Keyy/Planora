import { getApiBaseUrl } from "@/lib/config"
import { CSRF_HEADER_NAME, getCsrfToken } from "@/lib/csrf"
import { isDemoSession } from "@/lib/demo/flag"
import { describeError } from "@/lib/errors"
import { newTraceparent } from "@/lib/trace"

/**
 * Failures the person sees, reported to the service logs (FE-16). Error screens and boundaries
 * existed, but nobody besides the person in front of the screen learned that anything broke: an
 * uncaught error, a rejected promise nobody handled, a crash a boundary caught.
 *
 * A report holds what `describeError` keeps — name, message and stack with tokens redacted — the
 * error screen's digest, and the page's path without its query. It is sent anonymously (no
 * `Authorization`), with CSRF like every write and a fresh `traceparent`, as a `keepalive` request
 * so a report from a page being left still arrives (`POST /auth/api/v1/client-errors`).
 */

export type ClientErrorKind = "error" | "unhandledrejection" | "boundary" | "segment"

const ENDPOINT = "/auth/api/v1/client-errors"
/** At most this many reports leave one page load, and the same failure is reported once. */
const MAX_REPORTS = 10
const MAX_MESSAGE = 1000
const MAX_STACK = 8000
const DIGEST = /^[A-Za-z0-9_-]{1,120}$/

/**
 * Noise there is nothing to act on: an error in a script from another origin, which the browser
 * reduces to "Script error.", and the ResizeObserver notice browsers raise on a benign loop.
 */
const IGNORED = [/^Script error\.?$/, /^ResizeObserver loop/]

const reported = new Set<string>()

/** Report a failure; never throws, and does nothing on the server or in the demo sandbox. */
export function reportClientError(error: unknown, kind: ClientErrorKind, digest?: string): void {
  if (typeof window === "undefined" || isDemoSession()) return

  const described = describeError(error)
  // A failed request says where it went: method, path (without its query) and status.
  const request = described.status
    ? ` [${[described.method, described.url?.split("?")[0], described.status].filter(Boolean).join(" ")}]`
    : ""
  const message = `${described.message || "Unknown error"}${request}`.slice(0, MAX_MESSAGE)
  if (IGNORED.some((pattern) => pattern.test(message))) return

  const route = window.location.pathname.slice(0, 300) || "/"
  const key = `${kind}|${described.name ?? ""}|${message}|${route}`
  if (reported.has(key) || reported.size >= MAX_REPORTS) return
  reported.add(key)

  void send({
    kind,
    name: described.name?.slice(0, 120),
    message,
    stack: described.stack?.slice(0, MAX_STACK),
    digest: digest && DIGEST.test(digest) ? digest : undefined,
    route,
    occurredAt: new Date().toISOString(),
  })
}

/** Listen for what nothing else catches: uncaught errors and unhandled rejections. */
export function installClientErrorReporting(): () => void {
  const onError = (event: ErrorEvent) => reportClientError(event.error ?? event.message, "error")
  const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason, "unhandledrejection")
  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
  return () => {
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
  }
}

async function send(report: Record<string, unknown>): Promise<void> {
  try {
    const csrfToken = await getCsrfToken()
    await fetch(`${getApiBaseUrl()}${ENDPOINT}`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrfToken,
        traceparent: newTraceparent(),
      },
      body: JSON.stringify(report),
    })
  } catch {
    // A report must never become a failure of its own.
  }
}
