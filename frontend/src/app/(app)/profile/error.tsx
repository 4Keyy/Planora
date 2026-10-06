"use client"

import { SegmentError } from "@/components/ui/segment-error"

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <SegmentError error={error} reset={reset} segmentLabel="profile" />
}
