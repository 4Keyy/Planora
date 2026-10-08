"use client"

import { CrashScene } from "@/components/errors/scenes"

/**
 * A route that crashed outside the signed-in pages (each of those has its own boundary, so
 * the bar stays put): the landing page, the auth screens, anything else under the root.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashScene error={error} reset={reset} />
}
