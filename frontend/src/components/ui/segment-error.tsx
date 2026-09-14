"use client"

import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { StatusPanel } from "@/components/ui/status-panel"

/**
 * Shared segment-level error boundary content. Next.js renders this when an
 * uncaught error escapes a route segment's React tree. The user sees a friendly
 * message and a Reset action (per the Next.js contract), plus an escape hatch
 * back to /dashboard.
 *
 * The error is reported through console.error for the global reporter (the
 * ErrorBoundary in app/layout.tsx) to pick up. `error.message` is never shown:
 * a raw server message can carry a stack trace or another user's data, and it
 * tells the reader nothing. The digest is shown instead — an opaque id they can
 * quote in a bug report.
 *
 * This used to hand-roll its own buttons, and the primary one was styled
 * `bg-primary-600` — a colour that does not exist in the theme, so the class
 * emitted no CSS at all and the Retry button rendered as white text on a
 * transparent background. It was invisible on every error page in the product,
 * and nothing in the type system, the build or the test suite could see it.
 * Going through StatusPanel and Button means the styling is now covered by the
 * same tests and the same token scale as everything else.
 */
type Props = {
  error: Error & { digest?: string }
  reset: () => void
  segmentLabel: string
}

export function SegmentError({ error, reset, segmentLabel }: Props) {
  useEffect(() => {
    console.error(`[${segmentLabel}] segment-level error`, error)
  }, [error, segmentLabel])

  return (
    <StatusPanel
      size="page"
      tone="alert"
      icon={AlertTriangle}
      title={`Something went wrong while loading ${segmentLabel}.`}
      description="The page hit an error and could not finish rendering. You can retry, or head back to the dashboard."
      referenceId={error.digest}
      action={{ label: "Retry", onClick: reset }}
      secondaryAction={{ label: "Back to dashboard", href: "/dashboard" }}
    />
  )
}
