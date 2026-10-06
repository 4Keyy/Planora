import { useCallback, useEffect, useState } from "react"

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
  /**
   * A CALLBACK ref backed by state, not a `useRef`. Every modal in this product
   * mounts through `ModalPortal`, which renders null on its first pass and only
   * creates the portal from its own effect. With a `useRef` the trap's effect ran
   * one tick too early, found `ref.current === null`, and returned — and because
   * `active` never changed afterwards, it never ran again. The result was that
   * every dialog in the product had a focus trap that did nothing: focus stayed
   * on the page behind, Tab walked straight out, and focus was never returned to
   * the trigger on close.
   *
   * The hook's own tests passed throughout, because they mounted it without a
   * portal — a configuration no caller actually uses.
   *
   * Storing the node in state re-runs the effect at the moment the element
   * attaches, whenever that happens to be.
   */
  const [container, setContainer] = useState<T | null>(null)
  const ref = useCallback((node: T | null) => setContainer(node), [])

  useEffect(() => {
    if (!active) return
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
  }, [active, container])

  return ref
}
