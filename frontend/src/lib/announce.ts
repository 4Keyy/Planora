/**
 * One polite live region for changes a sighted reader sees but a screen reader would not.
 *
 * A key that changes a card in place — a priority set from the keyboard — redraws a
 * meter and says nothing: the meter is `role="img"`, and an image's new name is not
 * announced. A live region per card would be two hundred of them on a long list, each a
 * candidate for every mutation. So there is one, created on first use, outside React.
 *
 * The text is cleared and written a beat later so the same sentence twice is announced
 * twice: setting a live region to the text it already holds is not a change.
 */

let region: HTMLElement | null = null
let pending: ReturnType<typeof setTimeout> | null = null

export function announce(message: string): void {
  if (typeof document === "undefined" || !document.body) return
  if (!region || !region.isConnected) {
    region = document.createElement("div")
    region.setAttribute("role", "status")
    region.setAttribute("aria-live", "polite")
    region.setAttribute("aria-atomic", "true")
    region.className = "sr-only"
    document.body.appendChild(region)
  }
  const node = region
  node.textContent = ""
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    node.textContent = message
  }, 60)
}
