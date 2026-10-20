"use client"

import { useCallback, useRef, useState } from "react"
import { fetchTaskById, setTaskHidden, setViewerPreference } from "@/lib/api"
import { isTodoOwner, type Todo } from "@/types/todo"
import { keepPlace } from "@/utils/sort-tasks"

/**
 * How long an opening waits for the task's content before it opens with what it has. Long
 * enough for an answer that was not fetched ahead (a keyboard, a touch screen) to arrive with the
 * write it races; short enough that a slow network still answers the press. Whatever comes
 * later is one more glide of the card's height, never a snap.
 */
export const REVEAL_WAIT_MS = 350

/** A fetch made ahead of an opening is used within this long, or made again. */
const PREFETCH_TTL_MS = 20_000

export interface TaskVisibilityOptions {
  /** The task as the page holds it now. */
  find: (id: string) => Todo | undefined
  /** Applies a change to the task in every list the page holds it in. */
  update: (id: string, change: (todo: Todo) => Todo) => void
  /** Who is looking. */
  viewerId: string | null | undefined
  /** The author's display name, when the page knows it (a friend's task). */
  authorName?: (userId: string) => string | null | undefined
  /** A change could not be saved; the card is back as it was. */
  onError: () => void
  /**
   * What a task hidden by its viewer looks like in memory once the server has it. The tasks list
   * drops the details there, as the server will on the next load.
   */
  redactViewerHidden?: (todo: Todo) => Todo
}

export interface TaskVisibility {
  /** Hides an open task, or opens a hidden one. */
  toggle: (id: string) => Promise<void>
  /**
   * Starts fetching what opening a hidden task will show — called when a card is about to be
   * opened. Only the owner's own private tasks: those the server answers in full while hidden.
   */
  prefetch: (id: string) => void
  /** Whether a hide or an opening of this task is still on its way. */
  isPending: (id: string) => boolean
}

/**
 * The server answers a hidden task masked ("Hidden task", nothing else) when it has an audience
 * or is someone else's — the rule in `HiddenTodoDtoFactory.ShouldMask`. A masked task's content
 * can only be fetched once the server has been told it is open.
 */
const isMasked = (todo: Todo, viewerId: string | null | undefined) =>
  !isTodoOwner(todo, viewerId) || !!todo.hasSharedAudience

type Settled = { ok: true; value: Todo } | { ok: false } | null

/** The fetch's outcome if it settles within `ms`; `null` if it is still on its way. */
function within(promise: Promise<Todo>, ms: number): Promise<Settled> {
  return Promise.race([
    promise.then(
      (value): Settled => ({ ok: true, value }),
      (): Settled => ({ ok: false }),
    ),
    new Promise<Settled>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

/**
 * Hiding a task and opening it again, the same on every list.
 *
 * **Data before motion.** Opening a hidden card used to open it at once with the copy the list
 * had — which for a hidden task holds no description and no dates — and fetch the rest after the
 * write: the card glided to the height of what it had and snapped 135px taller when the rest came,
 * then moved to its date's place in the list (measured, 2026-10-12). Now the card opens once, with
 * everything it will show:
 *
 * - **The owner's own private task** reads in full even while hidden, so its content is fetched
 *   ahead — when the card is hovered, focused or pressed (`prefetch`) — and, if it was not, at
 *   the press, beside the write instead of after it. The card opens when the content is there, or
 *   after `REVEAL_WAIT_MS` with what it has; the write's failure closes it again.
 * - **A masked task** (an audience, or someone else's) is only readable once the server knows it
 *   is open, so the card stays folded, pending, until the write and the read are both back.
 *
 * Either way the opened card keeps the place it had in its list (`keepPlace`).
 */
export function useTaskVisibility({
  find,
  update,
  viewerId,
  authorName,
  onError,
  redactViewerHidden,
}: TaskVisibilityOptions): TaskVisibility {
  const ahead = useRef(new Map<string, { at: number; promise: Promise<Todo> }>())
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const inFlight = useRef(new Set<string>())
  const options = useRef({ find, update, viewerId, authorName, onError, redactViewerHidden })
  options.current = { find, update, viewerId, authorName, onError, redactViewerHidden }

  const prefetch = useCallback((id: string) => {
    const { find, viewerId } = options.current
    const todo = find(id)
    if (!todo?.hidden || isMasked(todo, viewerId)) return
    const held = ahead.current.get(id)
    if (held && Date.now() - held.at < PREFETCH_TTL_MS) return
    const promise = fetchTaskById(id)
    const entry = { at: Date.now(), promise }
    ahead.current.set(id, entry)
    promise.catch(() => {
      if (ahead.current.get(id) === entry) ahead.current.delete(id)
    })
  }, [])

  /** The fetch made ahead for this task, if it is fresh — handed over once. */
  const takeAhead = (id: string): Promise<Todo> | null => {
    const held = ahead.current.get(id)
    ahead.current.delete(id)
    return held && Date.now() - held.at < PREFETCH_TTL_MS ? held.promise : null
  }

  /** The copy in the list, opened: everything that arrived, in the place the hidden copy had. */
  const opened = (todo: Todo, full: Todo | null): Todo => {
    const name = full ? options.current.authorName?.(full.userId) : null
    const next: Todo = full ? { ...todo, ...full, ...(name ? { authorName: name } : {}), hidden: false } : { ...todo, hidden: false }
    return { ...next, heldPlace: keepPlace(todo, next, options.current.viewerId) }
  }

  const hide = async (todo: Todo, isOwner: boolean) => {
    const { update, onError, redactViewerHidden } = options.current
    const id = todo.id
    update(id, (t) => ({ ...t, hidden: true }))
    try {
      if (isOwner) {
        const response = await setTaskHidden(id, true)
        update(id, (t) => ({
          ...t,
          hidden: response.hidden,
          categoryName: response.categoryName ?? t.categoryName,
          categoryId: response.categoryId ?? t.categoryId,
        }))
      } else {
        await setViewerPreference(id, { hiddenByViewer: true })
        if (redactViewerHidden) update(id, redactViewerHidden)
      }
    } catch {
      update(id, (t) => ({ ...t, hidden: false }))
      onError()
    }
  }

  const revealPrivate = async (todo: Todo) => {
    const { update, onError } = options.current
    const id = todo.id
    const full = takeAhead(id) ?? fetchTaskById(id)
    const write = setTaskHidden(id, false)
    // A failed or slow write must not leave an unhandled rejection behind while the read is awaited.
    write.catch(() => {})
    const first = await within(full, REVEAL_WAIT_MS)
    update(id, (t) => opened(t, first?.ok ? first.value : null))
    try {
      const response = await write
      update(id, (t) => ({
        ...t,
        hidden: response.hidden,
        categoryName: response.categoryName ?? t.categoryName,
        categoryId: response.categoryId ?? t.categoryId,
      }))
    } catch {
      update(id, (t) => ({ ...t, hidden: true }))
      onError()
      return
    }
    if (first?.ok) return
    // Opened with what it had: the rest is one more glide when it comes.
    try {
      const late = first === null ? await full : await fetchTaskById(id)
      update(id, (t) => (t.hidden ? t : opened(t, late)))
    } catch {
      // The card stays open with what it has; the next load brings the rest.
    }
  }

  const revealMasked = async (todo: Todo, isOwner: boolean) => {
    const { update, onError } = options.current
    const id = todo.id
    try {
      if (isOwner) await setTaskHidden(id, false)
      else await setViewerPreference(id, { hiddenByViewer: false })
      const full = await fetchTaskById(id)
      update(id, (t) => opened(t, full))
    } catch {
      onError()
    }
  }

  const toggle = useCallback(async (id: string) => {
    const { find, viewerId } = options.current
    const todo = find(id)
    if (!todo || inFlight.current.has(id)) return
    inFlight.current.add(id)
    setPending((previous) => new Set(previous).add(id))
    try {
      const isOwner = isTodoOwner(todo, viewerId)
      if (!todo.hidden) await hide(todo, isOwner)
      else if (isMasked(todo, viewerId)) await revealMasked(todo, isOwner)
      else await revealPrivate(todo)
    } finally {
      inFlight.current.delete(id)
      setPending((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }
    // hide/reveal read the latest options through a ref; the toggle itself never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isPending = useCallback((id: string) => pending.has(id), [pending])

  return { toggle, prefetch, isPending }
}
