"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { SCROLL_BEHAVIOR } from "@/lib/animations"

/**
 * Keyboard navigation for a flat list of rows.
 *
 * The product shipped a command palette and then no way to move through the list
 * it searched: every completion, every edit, every deletion went through the
 * pointer. This is the other half — `j`/`k` to move, Enter to open, Space to
 * complete, `x` to gather a selection — over an arbitrary list of ids.
 *
 * The cursor is an ID, never an index. An index survives nothing this list does
 * to itself: completing a task removes a row, a filter change replaces the whole
 * array, a realtime update reorders it, and an index-based cursor then points at
 * a different task than the one the user was reading. When the active id really
 * does disappear the hook falls back to the nearest surviving index rather than
 * to nothing — losing your place entirely is what makes keyboard navigation feel
 * broken, and it is the most common way a hook like this is wrong.
 *
 * ONE window listener serves the whole list. One listener per row is 200
 * listeners for 200 tasks, and it would require each row to be focused before
 * its keys did anything — which is not how a list reads to a keyboard user.
 *
 * What this deliberately does NOT do is move DOM focus. Keys are served from the
 * window, so the list answers wherever the user is on the page; yanking focus
 * onto a row on every keystroke would fight with anything else that legitimately
 * holds it. Instead the active row is the single tabbable row (roving tabindex,
 * the ARIA authoring practice for a composite widget), so Tab enters the list
 * once and the arrows take over from there.
 *
 * The cursor therefore has two parts, a place and a visibility, and only the
 * keyboard sets the second. A click still moves the place: roving tabindex
 * remembers the last row anyone touched, so Tab and `j` carry on from the card
 * that was clicked. But a pointer press is not a request to see a keyboard
 * cursor, and drawing one around the card just clicked read as a focus ring that
 * would not go away. So any pointer press hides the ring, and Tab into the list,
 * a move, a jump or select-all shows it. A hidden cursor must not act, either:
 * Space after a click is a mouse user scrolling, and serving it here would
 * complete a task nobody could see was targeted. While the ring is hidden the
 * action keys are left to the browser, unprevented.
 *
 * Only Tab counts as keyboard focus. It is the one key that moves DOM focus onto
 * a row; everything else here moves the cursor without touching focus. Counting
 * any keydown, the way `:focus-visible` does, would redraw the ring when a
 * dialog opened by a click is closed with Escape and hands focus back to the row
 * by script. `:focus-visible` itself cannot carry the cursor for the same
 * reason in reverse: after `j` the cursor is somewhere focus is not.
 *
 * The hook is single-instance per page, and that falls out of the design rather
 * than being configured: the first listener's `preventDefault()` trips the
 * second's `defaultPrevented` guard, so a second list mounted alongside is
 * silently deaf. That is the right answer for a list nested inside a list — the
 * outer one should not also move — but two independent lists on one screen would
 * need a scope, and today nothing asks for one.
 */

/** Two `g` presses further apart than this are two `g` presses, not `gg`. */
const CHORD_WINDOW_MS = 500

const MIN_PRIORITY = 1
const MAX_PRIORITY = 5

/**
 * A key pressed into a text field belongs to the text field.
 *
 * Without this, typing "extra jam" into the create composer would edit a task,
 * toggle three others and delete one. `isContentEditable` alone is not enough:
 * jsdom does not implement it, and a caret inside a nested node of an editable
 * region reports the attribute on an ancestor rather than on the node itself.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (target.isContentEditable) return true
  return target.closest("[contenteditable]:not([contenteditable='false'])") !== null
}

/**
 * Enter and Space already mean something to a focused control.
 *
 * A row carries its own buttons — the checkbox, the overflow menu. With focus on
 * one of them, Enter fires that button's click AND would fire ours, so a single
 * press completed the task and opened it. The control wins; the list keys are
 * for when nothing in the row has focus.
 */
function isActivatableControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest("button, a[href], summary, [role='button']") !== null
}

export interface ListNavigationOptions {
  /** Ids in visual order. Selection follows this array by index. */
  ids: string[]
  /** Whether the hook listens at all (false while a modal/palette/composer is open). */
  enabled?: boolean
  onActivate?: (id: string) => void
  onToggleComplete?: (id: string) => void
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
  onPriority?: (id: string, level: number) => void
  onSelectionChange?: (ids: string[]) => void
}

/** Spread onto each row. Every field is derived from the id, so rows stay dumb. */
export interface ListRowProps {
  ref: (node: HTMLElement | null) => void
  /**
   * Focusing a row (Tab, or a click landing on a control inside it) makes it
   * active. It shows the ring only when Tab brought focus there: a click moves
   * the place and leaves the ring hidden.
   */
  onFocus: () => void
  tabIndex: 0 | -1
  /**
   * Present, valueless, on the active row while the cursor is shown: style it
   * with `[&[data-active]]:` variants. A pointer press anywhere hides it; Tab,
   * `j`/`k`, the arrows, `gg`/`G` and select-all show it again.
   */
  "data-active": "" | undefined
  /**
   * The cursor, for assistive technology.
   *
   * NOT `aria-selected`, which is only valid on `option`, `row`, `gridcell`,
   * `tab` and a few others. Making the rows `option`s would be the obvious way to
   * earn it and it is closed off here: an `option` must not contain focusable
   * descendants, and every row in this product carries its own checkbox and menu.
   * Claiming listbox semantics anyway would leave a screen reader announcing
   * controls that, by its own model of the page, cannot exist.
   *
   * `aria-current` says exactly what is true — this is the current item in a set —
   * and is valid on any element.
   *
   * It follows the ring, not the place. While the cursor is hidden the action
   * keys do nothing, so there is no row the keyboard would act on and nothing is
   * "current". A screen-reader user drives by keyboard, so for them the cursor is
   * shown and the attribute is there.
   */
  "aria-current": "true" | undefined
  /**
   * Multi-selection, for styling only.
   *
   * There is no ARIA attribute for "selected" that is legal here, so the fact is
   * spoken by the count in the bulk-action bar rather than by each row. A row that
   * silently carried an invalid attribute would be worse: it would look handled.
   */
  "data-selected": "" | undefined
}

export interface ListNavigation {
  /** The cursor's place. Kept through a click, so the keyboard resumes from it. */
  activeId: string | null
  /**
   * Whether the cursor is shown, and therefore whether the action keys act.
   * False after any pointer press until Tab or a navigation key shows it again.
   */
  cursorVisible: boolean
  selectedIds: string[]
  setActiveId: (id: string | null) => void
  clearSelection: () => void
  getRowProps: (id: string) => ListRowProps
  /**
   * The mounted node for a row, or null.
   *
   * The hook already holds every row's element for scroll-into-view; exposing it
   * lets a keyboard action reach the same DOM a click would have. The concrete
   * case is the card-to-editor transition, which grows the dialog out of the rect
   * of the card that opened it — pressing Enter has to hand over the same rect a
   * pointer would, or opening by keyboard silently loses the animation that
   * explains where the dialog came from.
   */
  getRowNode: (id: string) => HTMLElement | null
}

export function useListNavigation({
  ids,
  enabled = true,
  onActivate,
  onToggleComplete,
  onEdit,
  onDelete,
  onPriority,
  onSelectionChange,
}: ListNavigationOptions): ListNavigation {
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const reduce = useReducedMotion() ?? false

  /** Tab is the only key that moves DOM focus onto a row; a pointer press revokes it. */
  const focusByKeyboard = useRef(false)
  const rows = useRef(new Map<string, HTMLElement>())
  const rowHandles = useRef(new Map<string, Pick<ListRowProps, "ref" | "onFocus">>())
  /** Timestamp of a `g` awaiting its partner. 0 means no chord is open. */
  const chordAt = useRef(0)
  /** Where the active row was the last time it existed, for when it stops existing. */
  const lastIndex = useRef(0)

  /**
   * Everything the key handler reads goes through one ref, updated after every
   * commit.
   *
   * Callers pass inline lambdas (`onDelete={(id) => remove(id)}`), so a handler
   * that closed over the props directly would be a new function on every render
   * and the effect owning the window listener would tear it down and re-add it
   * on every keystroke. This keeps exactly one listener alive for the life of
   * the list while still reading this commit's props.
   *
   * Declared first on purpose: effects run in declaration order, so every effect
   * below is guaranteed to see values from the commit it is running for.
   */
  const latest = useRef({
    ids,
    activeId,
    cursorVisible,
    selectedIds,
    onActivate,
    onToggleComplete,
    onEdit,
    onDelete,
    onPriority,
    onSelectionChange,
  })
  useEffect(() => {
    latest.current = {
      ids,
      activeId,
      cursorVisible,
      selectedIds,
      onActivate,
      onToggleComplete,
      onEdit,
      onDelete,
      onPriority,
      onSelectionChange,
    }
  })

  /**
   * Which input moved focus last, tracked on the window in the capture phase.
   *
   * Capture, because the mark has to be set before the browser moves focus
   * (pointerdown, then mousedown, then focus) and no widget's stopPropagation may
   * eat it. The pointerdown half also covers the case no focus handler can see:
   * pressing the row that already holds focus fires no second focus event, and
   * the ring still has to go. Mouse, touch and pen are all one pointer here.
   *
   * Independent of `enabled` on purpose. A dialog is exactly when the list stops
   * listening for keys, and it is also when focus is about to be handed back to a
   * row; the mark must be right at that moment. Hiding an already hidden cursor
   * is a no-op for React, so a click anywhere on the page renders nothing.
   */
  useEffect(() => {
    const onPointerDown = () => {
      focusByKeyboard.current = false
      setCursorVisible(false)
    }
    const onTab = (event: KeyboardEvent) => {
      if (event.key === "Tab") focusByKeyboard.current = true
    }
    window.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onTab, true)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onTab, true)
    }
  }, [])

  /**
   * Reconcile against an id list that changed under us.
   *
   * Three things happen here and they all exist because the array is not stable:
   * the cursor moves to the nearest surviving row when its own row is gone, the
   * selection drops ids that no longer exist (otherwise a bulk action would be
   * sent for a task that is already deleted), and the row maps are pruned so a
   * long session does not accumulate a node per task it has ever rendered.
   *
   * The fallback moves the place and leaves the visibility alone: a task
   * completed with the mouse must not hand a ring to the task below it.
   *
   * Every branch returns the previous state object when nothing changed, so this
   * is safe to run on every render — which it does, because `ids` is usually a
   * fresh array literal from the caller.
   */
  useEffect(() => {
    const present = new Set(ids)

    if (activeId !== null) {
      const index = ids.indexOf(activeId)
      if (index !== -1) {
        lastIndex.current = index
      } else if (ids.length === 0) {
        setActiveIdState(null)
      } else {
        setActiveIdState(ids[Math.min(lastIndex.current, ids.length - 1)])
      }
    }

    setSelectedIds((prev) => {
      if (prev.length === 0) return prev
      const next = prev.filter((id) => present.has(id))
      return next.length === prev.length ? prev : next
    })

    for (const id of rowHandles.current.keys()) {
      if (!present.has(id)) {
        rowHandles.current.delete(id)
        rows.current.delete(id)
      }
    }
  }, [ids, activeId])

  /**
   * Report the selection to the caller, but not the empty one every list starts
   * with — a bulk-action bar that flickers open on mount is a worse bug than a
   * missed callback.
   */
  const selectionReported = useRef(false)
  useEffect(() => {
    if (!selectionReported.current) {
      selectionReported.current = true
      return
    }
    latest.current.onSelectionChange?.(selectedIds)
  }, [selectedIds])

  /**
   * Keep the cursor on screen. `block: "nearest"` is the whole point: it scrolls
   * only when the row is actually out of view, so arrowing down a visible list
   * does not yank the page a screenful at a time, and re-running this effect for
   * a row that is already visible does nothing.
   *
   * `MotionConfig reducedMotion="user"` covers framer-motion, not the platform's
   * scroller, so this one honours the preference itself.
   *
   * Only for a shown cursor. A click moves the place too, and scrolling a half
   * visible card into view under the pointer that just pressed it makes the page
   * jump away from the hand.
   */
  useEffect(() => {
    if (activeId === null || !cursorVisible) return
    const row = rows.current.get(activeId)
    if (!row) return
    row.scrollIntoView({ ...SCROLL_BEHAVIOR, behavior: reduce ? "auto" : SCROLL_BEHAVIOR.behavior })
  }, [activeId, cursorVisible, reduce])

  useEffect(() => {
    /**
     * `enabled: false` detaches rather than filters. While a dialog, the palette
     * or the composer is open, the list must not be able to pull a key out from
     * under it — and a handler that is merely inert still calls preventDefault
     * for the wrong owner if anyone edits it carelessly later. The active row is
     * left alone, so closing the dialog returns the user to their place.
     */
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      const state = latest.current
      const rowIds = state.ids

      // Something closer to the event already claimed this key.
      if (event.defaultPrevented) return
      if (isTextEntry(event.target)) return

      /**
       * Select-all is the one binding that takes a modifier, and it takes it
       * because every list application has trained the same fingers on it —
       * leaving ⌘A to select the page's text inside a task list is technically
       * the browser default and practically a bug. It is claimed BEFORE the
       * modifier bail-out below for that reason, and only when the list has rows
       * to select, so an empty list still gives the browser its default back.
       */
      if ((event.metaKey || event.ctrlKey) && (event.key === "a" || event.key === "A")) {
        if (rowIds.length === 0) return
        event.preventDefault()
        setSelectedIds(rowIds.slice())
        // Seat the cursor too. Row actions bail on a null cursor, so selecting
        // everything and then pressing Delete or Space did precisely nothing —
        // a dead keystroke immediately after the one keystroke most likely to
        // precede it. Only when there is no cursor yet: a user who walked to a
        // row and then pressed ⌘A should not be teleported back to the top.
        if (state.activeId === null || !rowIds.includes(state.activeId)) {
          setActiveIdState(rowIds[0])
        }
        // And show it: after a click the cursor is seated but hidden, and a
        // hidden cursor does not act, which would bring the dead keystroke back.
        setCursorVisible(true)
        return
      }

      // Meta/Ctrl/Alt otherwise belong to the browser and the OS — Ctrl+D is a
      // bookmark, not a delete. Shift is ours: it is half of extend-selection.
      if (event.metaKey || event.ctrlKey || event.altKey) return

      /**
       * Shift rewrites the character it produces: Shift+j arrives as `"J"`, not
       * as `"j"` with `shiftKey`. Reading `event.shiftKey` alone on the `"j"`
       * branch therefore matched nothing, and the vim-style extend-selection was
       * dead code that typechecked. Folding the case here means `Shift+J` and
       * `Shift+↓` are genuinely the same binding, which is what the keyboard map
       * promises. `G` stays out of it: that is a jump, not an extension.
       */
      const key = event.key === "J" ? "j" : event.key === "K" ? "k" : event.key
      const index = state.activeId === null ? -1 : rowIds.indexOf(state.activeId)

      const orderedFrom = (set: Set<string>) => rowIds.filter((id) => set.has(id))

      const step = (delta: number, extend: boolean) => {
        // With no cursor yet, the first move lands on the end you moved from:
        // `j` on the first row, `k` on the last.
        const from = index === -1 ? (delta > 0 ? -1 : rowIds.length) : index
        const to = from + delta
        // Clamped, never wrapped. Wrapping from the last row to the first in a
        // list taller than the viewport teleports the reader somewhere they did
        // not ask to be, and they have to hunt for the cursor again. A hidden
        // cursor already at the edge is still shown, or `j` on the last row after
        // a click would do nothing anyone could see.
        if (to < 0 || to >= rowIds.length) {
          if (index !== -1) setCursorVisible(true)
          return
        }
        const nextId = rowIds[to]
        const currentId = state.activeId
        if (extend && currentId !== null && currentId !== nextId) {
          setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(nextId)) {
              // Moving back over a row that is already in the selection shrinks
              // it, so a mis-aimed Shift+Down is undone by Shift+Up rather than
              // growing the selection in both directions.
              next.delete(currentId)
            } else {
              next.add(currentId)
              next.add(nextId)
            }
            return orderedFrom(next)
          })
        }
        setActiveIdState(nextId)
        setCursorVisible(true)
      }

      // ── Moving ──────────────────────────────────────────────────────────────
      // Arrows are prevented because the page would scroll on top of the
      // scroll-into-view this hook is already doing, and the two fight.
      if (key === "j" || key === "ArrowDown") {
        event.preventDefault()
        step(1, event.shiftKey)
        chordAt.current = 0
        return
      }
      if (key === "k" || key === "ArrowUp") {
        event.preventDefault()
        step(-1, event.shiftKey)
        chordAt.current = 0
        return
      }
      if (key === "g") {
        const now = Date.now()
        const completesChord = chordAt.current !== 0 && now - chordAt.current < CHORD_WINDOW_MS
        chordAt.current = completesChord ? 0 : now
        if (completesChord && rowIds.length > 0) {
          event.preventDefault()
          setActiveIdState(rowIds[0])
          setCursorVisible(true)
        }
        return
      }
      // Any other key ends a half-typed `gg`, so `g` then `k` then `g` is one
      // pending chord rather than a jump to the top.
      chordAt.current = 0

      if (key === "G") {
        if (rowIds.length === 0) return
        event.preventDefault()
        setActiveIdState(rowIds[rowIds.length - 1])
        setCursorVisible(true)
        return
      }

      if (key === "Escape") {
        /**
         * Escape unwinds one layer per press: the selection first, then the
         * cursor. Clearing both at once means a user who gathered ten rows and
         * pressed Escape to cancel also loses the place they spent ten presses
         * reaching. Not prevented — an outer layer may have its own meaning for
         * Escape and this one is not exclusive.
         */
        if (state.selectedIds.length > 0) {
          setSelectedIds([])
        } else {
          setActiveIdState(null)
          setCursorVisible(false)
        }
        return
      }

      // ── Acting on the row under the cursor ──────────────────────────────────
      /**
       * These fire for the ACTIVE row only, never for the whole selection. The
       * selection is reported through `onSelectionChange` so the caller can put
       * a deliberate bulk action behind it; a `Delete` that silently took twelve
       * tasks because an `x` earlier scrolled out of view is not a keystroke
       * anyone can take back.
       */
      const targetId = state.activeId
      if (targetId === null) return
      // A hidden cursor is a place, not a target. Returning before any
      // preventDefault is the point: Space scrolls, Backspace and Enter reach
      // whatever the page meant by them, and no task changes under a ring nobody
      // can see.
      if (!state.cursorVisible) return

      if ((key === "Enter" || key === " ") && isActivatableControl(event.target)) return

      if (key === "Enter") {
        event.preventDefault()
        state.onActivate?.(targetId)
        return
      }
      if (key === " ") {
        // Without this the page jumps a screenful on every completion, because
        // Space is the browser's page-down.
        event.preventDefault()
        state.onToggleComplete?.(targetId)
        return
      }
      if (key === "e") {
        event.preventDefault()
        state.onEdit?.(targetId)
        return
      }
      if (key === "Delete" || key === "Backspace") {
        // Backspace outside a field still means "back" in some browsers and in
        // every user's muscle memory from the ones where it did.
        event.preventDefault()
        state.onDelete?.(targetId)
        return
      }
      if (key === "x") {
        event.preventDefault()
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (next.has(targetId)) next.delete(targetId)
          else next.add(targetId)
          return orderedFrom(next)
        })
        return
      }
      if (key >= String(MIN_PRIORITY) && key <= String(MAX_PRIORITY) && key.length === 1) {
        event.preventDefault()
        state.onPriority?.(targetId, Number(key))
      }
    }

    /**
     * Bubble phase, not capture. A widget inside a row — a date popover, a menu —
     * can claim a key by stopping propagation, which is impossible to do against
     * a capture-phase listener on the window.
     */
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      // A `g` left pending when the list stops listening must not complete a
      // chord with the first `g` pressed after it starts listening again.
      chordAt.current = 0
    }
  }, [enabled])

  /**
   * One cached ref callback and one focus handler per id, for the life of that
   * id. A fresh callback ref each render makes React detach and re-attach the
   * node — ref(null) then ref(node) — on every keystroke, so the map the
   * scroll-into-view effect reads would be momentarily empty exactly when it
   * runs.
   */
  const handlesFor = useCallback((id: string): Pick<ListRowProps, "ref" | "onFocus"> => {
    const cached = rowHandles.current.get(id)
    if (cached) return cached
    const handles = {
      ref: (node: HTMLElement | null) => {
        if (node) rows.current.set(id, node)
        else rows.current.delete(id)
      },
      // Reads only a ref and stable setters, so the cached handler stays valid
      // for the life of the id. It only ever shows the ring: hiding it is the
      // pointerdown listener's job, which has already run by the time a click's
      // focus arrives here.
      onFocus: () => {
        setActiveIdState(id)
        if (focusByKeyboard.current) setCursorVisible(true)
      },
    }
    rowHandles.current.set(id, handles)
    return handles
  }, [])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const getRowProps = useCallback(
    (id: string): ListRowProps => {
      const isActive = id === activeId
      /**
       * Exactly one row is in the tab order. Before the list has a cursor that
       * is the first row, so Tab can enter the list at all — a list where every
       * row is `tabIndex={-1}` is unreachable by keyboard, which is the failure
       * this pattern is usually introduced to cause.
       */
      const tabbable = activeId === null ? ids[0] === id : isActive
      // The tab stop follows the place; the ring and `aria-current` follow the
      // place only while the keyboard is the one looking at it.
      const shown = isActive && cursorVisible
      return {
        ...handlesFor(id),
        tabIndex: tabbable ? 0 : -1,
        "data-active": shown ? "" : undefined,
        "aria-current": shown ? "true" : undefined,
        "data-selected": selectedSet.has(id) ? "" : undefined,
      }
    },
    [activeId, cursorVisible, ids, selectedSet, handlesFor],
  )

  /** Placing the cursor by hand is a deliberate act, so it is shown; clearing it hides it. */
  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id)
    setCursorVisible(id !== null)
  }, [])
  const clearSelection = useCallback(() => setSelectedIds([]), [])
  const getRowNode = useCallback((id: string) => rows.current.get(id) ?? null, [])

  return { activeId, cursorVisible, selectedIds, setActiveId, clearSelection, getRowProps, getRowNode }
}
