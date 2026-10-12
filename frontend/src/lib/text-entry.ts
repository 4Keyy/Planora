/**
 * A key pressed into a text field belongs to the text field.
 *
 * Without this, typing "extra jam" into the create composer would edit a task,
 * toggle three others and delete one. `isContentEditable` alone is not enough:
 * jsdom does not implement it, and a caret inside a nested node of an editable
 * region reports the attribute on an ancestor rather than on the node itself.
 *
 * It lives here rather than in the list hook so that every keyboard layer that
 * answers keys from the window — the list, the priority keys under the pointer —
 * asks the same question the same way, and none of them imports another to ask it.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (target.isContentEditable) return true
  return target.closest("[contenteditable]:not([contenteditable='false'])") !== null
}
