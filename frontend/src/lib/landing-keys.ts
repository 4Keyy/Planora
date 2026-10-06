/**
 * Which row of the landing console's key legend a keystroke belongs to.
 *
 * The legend is the block's claim — "every key listed here is bound on this page" — and
 * lighting the row a visitor just pressed turns the claim into something they watch
 * happen. Kept pure so the mapping is tested without a DOM: it is easy to get subtly wrong
 * (Shift turns `j` into `"J"`, `⌘K` arrives as a lowercase `"k"` with a modifier, and a
 * bare `k` must not light the palette row).
 *
 * `rowKeys` are the keys that act on the row under the cursor. The console lights those
 * only when the cursor is shown, because with a hidden cursor they do nothing — and a
 * legend that lights up for a key that did nothing is the same lie in a new place.
 */

export type LegendKey = "J K" | "⏎" | "E" | "Space" | "1–5" | "Delete" | "Mod K" | "?"

export const ROW_KEYS: ReadonlySet<LegendKey> = new Set<LegendKey>(["⏎", "E", "Space", "1–5", "Delete"])

export interface KeyLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}

export function legendKeyFor(event: KeyLike): LegendKey | null {
  const { key } = event
  const mod = Boolean(event.metaKey || event.ctrlKey)

  if (mod && !event.altKey && (key === "k" || key === "K")) return "Mod K"
  // Every other modified key belongs to the browser or the OS, as it does in the list hook.
  if (mod || event.altKey) return null

  switch (key) {
    case "j":
    case "J":
    case "k":
    case "K":
    case "ArrowDown":
    case "ArrowUp":
      return "J K"
    case "Enter":
      return "⏎"
    case "e":
    case "E":
      return "E"
    case " ":
      return "Space"
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
      return "1–5"
    case "Delete":
    case "Backspace":
      return "Delete"
    case "?":
      return "?"
    default:
      return null
  }
}
