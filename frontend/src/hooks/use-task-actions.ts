"use client"

import { useMemo, useRef } from "react"
import { api, getApiErrorMessage, parseApiResponse, setViewerPreference, type ApiResponse } from "@/lib/api"
import { AUTHOR_COMPLETED_TOAST, describeError, isAuthorAlreadyCompletedError } from "@/lib/errors"
import { useToastStore } from "@/store/toast"
import { isCompletedTodoStatus, isTodoOwner, type Todo } from "@/types/todo"

/** What the viewer-preference endpoint says about the viewer's completion once it has saved it. */
export type ViewerCompletion = Awaited<ReturnType<typeof setViewerPreference>>

/**
 * How a page's completion control reads a press. The defaults are the active lists' (Dashboard,
 * Tasks); every other value is a page that has always behaved differently, and the differences
 * are listed in docs/features.md (Task actions).
 */
export interface CompletionRules {
  /**
   * Which way a press goes. `toggle` follows the task's state; the archive only ever reopens, and
   * the landing console — whose list holds open tasks only — only ever completes.
   */
  direction?: "toggle" | "reopen" | "complete"
  /**
   * Which non-owners complete through their own viewer preference instead of the task's status:
   * those of a shared task (a hidden friend's task reads as unshared and goes through the status,
   * which the server also records for that viewer alone), or every non-owner (the archive).
   */
  viewerPreference?: "shared" | "non-owner"
  /**
   * How a press reads whether the task is done now, and what the author-closed refusal covers.
   * `by-route` (the lists): a viewer-preference press reads the viewer's own mark and is refused,
   * either way, once the author has closed the task; a status press reads the status. `for-viewer`
   * (the branch page): a non-owner always reads their own mark, and only their reopening is
   * refused — completing a task its author has closed is still theirs to do.
   */
  reading?: "by-route" | "for-viewer"
}

/** A completion the server took, handed to the page to show in its lists. */
export type CompletionOutcome = {
  /** The task as the page held it when it was pressed. */
  todo: Todo
  /** The press reopened the task; otherwise it completed it. */
  reopened: boolean
} & (
  | {
      via: "viewer"
      result: ViewerCompletion
      /** The viewer's own mark, as the server now holds it, applied to a copy of the task. */
      patch: (todo: Todo) => Todo
    }
  | {
      via: "status"
      /** The task as the server answered the status change. */
      updated: Todo
    }
)

export interface TaskActionsOptions {
  /** Who is looking. */
  viewerId: string | null | undefined
  /** How this page's completion control reads a press. */
  completion?: CompletionRules
  /** Failures are also written to the console (Tasks, the archive). */
  log?: boolean
  /** Failure notices carry the server's message as their description (the branch page). */
  describe?: boolean
}

/**
 * Every action takes the task as the page holds it now — and does nothing when the page no longer
 * holds it (a card removed while its handler was on its way). `apply` puts the server's answer into
 * the page's lists; it runs once the server has agreed and before the notice, and whatever it throws
 * is reported as the action's failure.
 */
type Held = Todo | null | undefined

export interface TaskActions {
  /**
   * Completes or reopens a task, as the page's rules read the press: the owner through the task's
   * status, a viewer through their own mark. Nothing is sent once the author has closed a task the
   * viewer may not touch — the notice says so instead.
   */
  complete: (todo: Held, apply: (outcome: CompletionOutcome) => void | Promise<void>) => Promise<void>
}

const isShared = (todo: Todo) => todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0

/**
 * What a task's actions send and say, the same on every page that shows tasks (audit FE-24).
 *
 * Dashboard, Tasks, the archive, the branch page and the landing console each carried their own
 * copy of these handlers, and the copies had drifted: the same press sent different requests and
 * said different things depending on the page. The requests, the author-closed refusal and the
 * notices live here now; each page keeps only how a result lands in its own lists (`apply`) and
 * the rules it has always had (`completion`), which name every remaining difference.
 *
 * The returned actions never change: they read the latest options through a ref, so a memoized
 * card's stale handler still acts for the viewer and rules of today.
 */
export function useTaskActions(options: TaskActionsOptions): TaskActions {
  const addToast = useToastStore((s) => s.addToast)
  const latest = useRef({ ...options, addToast })
  latest.current = { ...options, addToast }

  return useMemo(() => {
    const log = (label: string, error: unknown) => {
      if (latest.current.log) console.error(label, describeError(error))
    }

    /** The error notice every action ends with, carrying the server's message where the page asks. */
    const fail = (title: string, error: unknown) => {
      const { describe, addToast } = latest.current
      addToast({ type: "error", title, ...(describe ? { description: getApiErrorMessage(error, title) } : {}) })
    }

    const complete: TaskActions["complete"] = async (todo, apply) => {
      if (!todo) return
      const { viewerId, completion = {}, addToast } = latest.current
      const { direction = "toggle", viewerPreference = "shared", reading = "by-route" } = completion
      const owner = isTodoOwner(todo, viewerId)
      const viaViewer = !owner && (viewerPreference === "non-owner" || isShared(todo))
      const readsMark = reading === "for-viewer" ? !owner : viaViewer
      const done =
        direction === "reopen" ? true
        : direction === "complete" ? false
        : readsMark ? todo.isCompletedByViewer === true
        : isCompletedTodoStatus(todo.status)

      // Once the author closes the whole task it is closed for everyone: the viewer is told to
      // duplicate it before anything is sent, instead of after a premature "Task completed".
      const refused = todo.ownerCompleted === true && (reading === "for-viewer" ? !owner && done : viaViewer)
      if (refused) {
        addToast(AUTHOR_COMPLETED_TOAST)
        return
      }

      const verb = direction === "reopen" ? "reopen" : "update"
      try {
        if (viaViewer) {
          const result = await setViewerPreference(todo.id, { completedByViewer: !done })
          await apply({
            via: "viewer",
            todo,
            reopened: done,
            result,
            patch: (t) => ({ ...t, isCompletedByViewer: result.completedByViewer ?? false, ownerCompleted: result.ownerCompleted }),
          })
        } else {
          const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${todo.id}`, { status: done ? "todo" : "done" })
          await apply({ via: "status", todo, reopened: done, updated: parseApiResponse(res.data) })
        }
        addToast({ type: "success", title: done ? "Task reopened" : "Task completed" })
      } catch (error) {
        log(viaViewer ? `Failed to ${verb} viewer completion:` : `Failed to ${verb} todo:`, error)
        // The server refuses a viewer's reopening of a task its author closed on either route.
        if (isAuthorAlreadyCompletedError(error)) addToast(AUTHOR_COMPLETED_TOAST)
        else fail("Couldn't update task", error)
      }
    }

    return { complete }
  }, [])
}
