import { useEffect, useRef } from "react"

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

/**
 * Focus management for a custom modal dialog. When `active` becomes true it remembers the element
 * that had focus, moves focus into the dialog (first focusable, else the container), and traps
 * Tab / Shift+Tab inside it; when `active` becomes false it restores focus to where it was. Pair the
 * returned ref with `role="dialog"`, `aria-modal="true"` and `tabIndex={-1}` on the same node so the
 * dialog is announced and can hold focus when it has no focusable child.
 *
 * Keeps a custom (non-Radix) modal accessible: focus can't wander to the page behind it, and a
 * keyboard / screen-reader user lands inside the dialog and returns to their trigger on close.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(active: boolean) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // NB: do NOT filter by `offsetParent` — it is null for position:fixed nodes (modals live in
    // fixed/portal containers) in real browsers and for everything in jsdom, which would wrongly
    // empty the list. The selector already drops disabled and tabindex="-1" elements.
    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))

    // Move focus into the dialog (deferred a frame so the entrance animation has mounted children).
    const raf = requestAnimationFrame(() => {
      const items = focusable()
      ;(items[0] ?? container).focus()
    })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        container.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const activeEl = document.activeElement
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("keydown", onKeyDown, true)
      // Restore focus to the trigger only if it is still in the document.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [active])

  return ref
}
