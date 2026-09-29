/**
 * The state of the landing page's "two lists, one task" block, as a pure reducer.
 *
 * Three facts drive it, each true of the product:
 *
 * - A viewer's tick is theirs alone. It is stored as a per-viewer preference
 *   (`UserTodoViewPreference.CompletedByViewer`); the owner's task does not change.
 * - A viewer may reopen their own tick — unless the owner has completed the task, which
 *   closes it for everyone. Then only the owner can reopen it
 *   (`SetViewerPreferenceCommandHandler`, and `TodoCard`'s own guard).
 * - Hiding a shared task makes the server send the viewer "Hidden task" instead of its
 *   title (`HiddenTodoDtoFactory`). The owner's copy is untouched.
 *
 * The block used to set `isCompletedByViewer` on the card's todo, which `TodoCard` never
 * reads — it renders "done" from its `variant` prop — so "Tick it off for me" did nothing
 * at all. It also claimed a viewer "cannot reopen" their tick, which the code allows.
 */

export interface ViewerState {
  viewerDone: boolean
  viewerHidden: boolean
  ownerDone: boolean
  /** Victoria folding the card away on her own screen — hers alone, like yours. */
  ownerHidden: boolean
  /** What the last action did — drives the sentence and the signal. */
  last: ViewerEvent | null
  /** Increments on every action, so the same event twice replays its animation. */
  seq: number
}

export type ViewerEvent =
  | "viewer-done"
  | "viewer-reopened"
  | "viewer-refused"
  | "viewer-hidden"
  | "viewer-shown"
  | "owner-done"
  | "owner-reopened"
  | "owner-hidden"
  | "owner-shown"
  | "owner-delete-note"
  | "open-note"
  | "reset"

export type ViewerAction =
  | { type: "viewer-toggle-done" }
  | { type: "viewer-toggle-hidden" }
  | { type: "owner-toggle-done" }
  | { type: "owner-toggle-hidden" }
  /** The owner card's delete control: explained, never performed — the block has one task. */
  | { type: "owner-delete" }
  /** A press on a card's body, which in the app opens the task's branch. */
  | { type: "open-card" }
  | { type: "reset" }

export const INITIAL_VIEWER_STATE: ViewerState = {
  viewerDone: false,
  viewerHidden: false,
  ownerDone: false,
  ownerHidden: false,
  last: null,
  seq: 0,
}

export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  const next = (patch: Partial<ViewerState>, last: ViewerEvent): ViewerState => ({
    ...state,
    ...patch,
    last,
    seq: state.seq + 1,
  })

  switch (action.type) {
    case "viewer-toggle-done":
      // Closed for everyone: the viewer's own switch is not theirs to flip any more.
      if (state.ownerDone) return next({}, "viewer-refused")
      return state.viewerDone
        ? next({ viewerDone: false }, "viewer-reopened")
        : next({ viewerDone: true }, "viewer-done")
    case "viewer-toggle-hidden":
      return state.viewerHidden
        ? next({ viewerHidden: false }, "viewer-shown")
        : next({ viewerHidden: true }, "viewer-hidden")
    case "owner-toggle-done":
      return state.ownerDone
        ? next({ ownerDone: false }, "owner-reopened")
        : next({ ownerDone: true }, "owner-done")
    case "owner-toggle-hidden":
      return state.ownerHidden
        ? next({ ownerHidden: false }, "owner-shown")
        : next({ ownerHidden: true }, "owner-hidden")
    case "owner-delete":
      return next({}, "owner-delete-note")
    case "open-card":
      return next({}, "open-note")
    case "reset":
      return { ...INITIAL_VIEWER_STATE, last: "reset", seq: state.seq + 1 }
  }
}

/** Whether the viewer's card renders as done: their own tick, or the owner's for everyone. */
export function viewerCardDone(state: ViewerState): boolean {
  return state.viewerDone || state.ownerDone
}

export type StatusLabel = "Open" | "Done for you" | "Hidden" | "Done for everyone"

export function viewerStatus(state: ViewerState): StatusLabel {
  if (state.ownerDone) return "Done for everyone"
  // A completed card does not collapse (`TodoCard` only hides open tasks), so a ticked
  // task reads as done even if it was also hidden.
  if (state.viewerDone) return "Done for you"
  if (state.viewerHidden) return "Hidden"
  return "Open"
}

export function ownerStatus(state: ViewerState): StatusLabel {
  return state.ownerDone ? "Done for everyone" : "Open"
}

const SENTENCES: Record<ViewerEvent, string> = {
  "viewer-done": "You ticked it off. Victoria's list is unchanged.",
  "viewer-reopened": "You reopened it for yourself. That's allowed while Victoria hasn't finished it.",
  "viewer-refused": "Victoria finished it for everyone, so only Victoria can reopen it now.",
  "viewer-hidden": "You hid it. The server stops sending you its title.",
  "viewer-shown": "It's back in your list, title and all.",
  "owner-done": "Victoria finished it, so it's done for everyone, you included.",
  "owner-reopened": "Victoria reopened it. Your list goes back to your own tick.",
  "owner-hidden": "Victoria folded it away on her screen. Yours doesn't change.",
  "owner-shown": "Victoria unfolded it again. Still nothing changes on your side.",
  "owner-delete-note": "Only Victoria can delete it. If she did, it would leave your list too.",
  "open-note": "In the app, pressing a card opens its branch: the task's own timeline.",
  reset: "Back to the start.",
}

export const IDLE_SENTENCE = "Try it on your side first. Victoria's list won't budge."

export function sentenceFor(event: ViewerEvent | null): string {
  return event ? SENTENCES[event] : IDLE_SENTENCE
}

/**
 * Where a change travels, for the signal between the two lists. An illustration of where
 * a change goes, not a network trace — the caption under the lists says the same in words.
 */
export type Signal = "stays-with-viewer" | "owner-to-viewer" | null

export function signalFor(event: ViewerEvent | null): Signal {
  if (event === "viewer-done" || event === "viewer-reopened") return "stays-with-viewer"
  if (event === "owner-done" || event === "owner-reopened") return "owner-to-viewer"
  return null
}
