/**
 * Lightweight haptic feedback for meaningful, low-frequency actions (completing
 * or creating a task — never rapid/repeated interactions).
 *
 * navigator.vibrate is supported on Android / Chrome and is silently ignored on
 * iOS Safari and desktop, so this is always a safe no-op where unsupported.
 * Patterns are intentionally tiny — a confirmation tap, not a buzz. Honours
 * prefers-reduced-motion as a proxy for "minimise non-essential feedback".
 */
type HapticKind = "tap" | "success" | "error"

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  success: [10, 28, 14],
  error: [22, 40, 22],
}

export function haptic(kind: HapticKind = "tap"): void {
  if (typeof navigator === "undefined") return
  const vibrate = navigator.vibrate?.bind(navigator)
  if (!vibrate) return
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return
  }
  try {
    vibrate(PATTERNS[kind])
  } catch {
    /* some browsers throw if called outside a user gesture — ignore */
  }
}
