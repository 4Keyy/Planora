/**
 * Tiny, SSR-safe store for lightweight local UI preferences (e.g. "don't show this warning again").
 *
 * These are deliberately client-only and non-critical: they live in localStorage, never leave the
 * device, and any access failure (private mode, storage disabled, SSR) degrades to the default
 * rather than throwing. Do NOT use this for anything security- or correctness-sensitive.
 */

const PREFIX = "planora:pref:"

/** Suppress the "this task still has unfinished subtasks — finish anyway?" confirmation. */
export const SUPPRESS_INCOMPLETE_SUBTASK_WARNING = "suppressIncompleteSubtaskWarning"

/** Reads a boolean preference. Returns false when unset, on the server, or if storage is unavailable. */
export function getBoolPreference(key: string): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(PREFIX + key) === "1"
  } catch {
    return false
  }
}

/** Persists a boolean preference. A false value removes the key so storage stays tidy. No-op on the server. */
export function setBoolPreference(key: string, value: boolean): void {
  if (typeof window === "undefined") return
  try {
    if (value) window.localStorage.setItem(PREFIX + key, "1")
    else window.localStorage.removeItem(PREFIX + key)
  } catch {
    /* storage unavailable — the preference simply doesn't persist */
  }
}
