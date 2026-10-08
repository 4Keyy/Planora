"use client"

import { CrashScene } from "@/components/errors/scenes"

/**
 * Shared segment-level error boundary content. Next.js renders this when an
 * uncaught error escapes a route segment's React tree, inside the app's frame, so
 * the bar stays where it was. The user sees what happened, a Retry (per the Next.js
 * contract), and a way back to the dashboard; offline, it says so and retries by
 * itself when the connection returns (`CrashScene`).
 *
 * The error is reported through console.error for the global reporter (the
 * ErrorBoundary in app/layout.tsx) to pick up. `error.message` is never shown:
 * a raw server message can carry a stack trace or another user's data, and it
 * tells the reader nothing. The digest is shown instead — an opaque id they can
 * quote in a bug report.
 */
type Props = {
  error: Error & { digest?: string }
  reset: () => void
  segmentLabel: string
}

export function SegmentError({ error, reset, segmentLabel }: Props) {
  return <CrashScene error={error} reset={reset} variant="inline" segmentLabel={segmentLabel} />
}
