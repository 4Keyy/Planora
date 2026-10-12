import type { LegendKey } from "@/lib/landing-keys"

/**
 * "That key just did something", said by whatever acted on it.
 *
 * A key legend that lights the row of the key just pressed teaches the keyboard better
 * than any paragraph — but only if it lights for keys that did something. Lighting on
 * every keydown would light `Space` while the cursor is hidden and `3` over a friend's
 * task, where both are ignored, and a legend that lights for a key that did nothing is
 * the one lie it exists to avoid. So the layers that act say so after acting: the list
 * hook for its cursor's keys, the priority keys for the card under the pointer. A legend
 * listens and never has to guess.
 *
 * A window event rather than a store: nothing has to be mounted to say it, and nothing
 * re-renders when nobody is listening.
 */

export const KEY_ECHO_EVENT = "planora:key-echo"

export function echoKey(key: LegendKey): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<LegendKey>(KEY_ECHO_EVENT, { detail: key }))
}
