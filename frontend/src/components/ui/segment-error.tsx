"use client"

import { useEffect } from "react"
import Link from "next/link"

/**
 * Shared segment-level error boundary content. Next.js renders this when an
 * uncaught error escapes a route segment's React tree. Kept minimal — the
 * user sees a friendly message and a Reset action (per Next.js spec), plus
 * an escape hatch back to /dashboard.
 *
 * The error itself is reported via console.error for the existing global
 * error reporter (the ErrorBoundary in app/layout.tsx) to pick up; we do
 * not surface the raw error.message to users (potential PII / stack-trace
 * leak risk).
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
    <div className="mx-auto w-full max-w-2xl py-16 text-center">
      <h2 className="text-2xl font-semibold text-gray-900">
        Something went wrong while loading {segmentLabel}.
      </h2>
      <p className="mt-2 text-sm text-gray-500">
        The page hit an error and could not finish rendering. You can retry, or head back to the dashboard.
      </p>
      {error.digest ? (
        <p className="mt-3 text-xs text-gray-400">
          Reference id: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 transition"
        >
          Retry
        </button>
        <Link
          href="/dashboard"
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
