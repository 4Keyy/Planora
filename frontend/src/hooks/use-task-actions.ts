"use client"

import { useMemo, useRef } from "react"
import {
  api, duplicateTodo, fetchTaskById, getApiErrorMessage, joinTodo, leaveTodo, parseApiResponse,
  setViewerPreference, type ApiResponse,
} from "@/lib/api"
import type { PendingAction } from "@/components/ui/undo-bar"
import { AUTHOR_COMPLETED_TOAST, describeError, isAuthorAlreadyCompletedError } from "@/lib/errors"
import { useToastStore } from "@/store/toast"
import { isCompletedTodoStatus, isTodoOwner, toApiTodoStatus, type Todo, type UpdateTodoPayload } from "@/types/todo"
import { applyCategoryPatch } from "@/utils/todo-utils"

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

/**
 * What starting and stopping work say on a page. The defaults are the branch page's; Dashboard and
 * Tasks have always worded these differently (docs/features.md, Task actions).
 */
export interface WorkWording {
  /** Said once work has started (Dashboard: "Task taken"); nothing by default. */
  started?: string
  /** The owner could not take the task into work. Default "Couldn't update task". */
  startFailed?: string
  /** A non-owner could not join as a worker. Default: `startFailed`. */
  joinFailed?: string
  /**
   * A join the server turns down because the task is full or already joined (409) is a warning
   * that says so (Tasks), not a `joinFailed`.
   */
  explainFull?: boolean
  /** Said once work has stopped (Dashboard: "Left task"); nothing by default. */
  stopped?: string
  /** The owner could not take the task out of work. Default "Couldn't stop working". */
  stopFailed?: string
  /** A non-owner could not leave. Default: `stopFailed`. */
  leaveFailed?: string
}

/** Work started: the owner moved the task into work, or the viewer joined it as a worker. */
export type StartedWork = {
  todo: Todo
  via: "status" | "worker"
  /** The server's task: its answer to the status change, or the task as joined. */
  updated: Todo
  /** The change on a copy of the task: "In Progress" for the owner, the joined task for a worker. */
  patch: (todo: Todo) => Todo
}

/** Work stopped: the owner moved the task back to Todo, or the viewer left its workers. */
export type StoppedWork = {
  todo: Todo
  /** The change on a copy of the task: "Todo" for the owner, one worker fewer for a worker. */
  patch: (todo: Todo) => Todo
} & ({ via: "status"; /** The server's answer to the status change. */ updated: Todo } | { via: "worker" })

export interface TaskActionsOptions {
  /** Who is looking. */
  viewerId: string | null | undefined
  /** How this page's completion control reads a press. */
  completion?: CompletionRules
  /** What starting and stopping work say here. */
  work?: WorkWording
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
  /**
   * Takes a task into work: the owner moves its status to In Progress, anyone else joins it as a
   * worker. With `onFull`, a join turned down as full (where the page explains that) reads the task
   * again and hands it over, so the card shows who is on it now.
   */
  startWork: (
    todo: Held,
    apply: (outcome: StartedWork) => void | Promise<void>,
    options?: { onFull?: (fresh: Todo) => void },
  ) => Promise<void>
  /** Takes a task out of work: the owner moves its status back to Todo, a worker leaves it. */
  stopWork: (todo: Held, apply: (outcome: StoppedWork) => void | Promise<void>) => Promise<void>
  /**
   * Makes a fresh active copy of a task — open to any participant. `apply` gets the copy (the lists
   * read themselves again, the branch page opens it); the notice's `description` says what happens
   * next. A failure is thrown on after its notice, for the editor's own error line.
   */
  duplicate: (
    todoId: string | null | undefined,
    apply?: (copy: Todo) => void | Promise<void>,
    description?: string,
  ) => Promise<void>
  /**
   * Saves the editor's changes with the task's status as it is — the editor never sends one; work
   * and completion move it. `apply` gets the saved task, its category cleared when the editor
   * cleared it, and the task as the page held it. A failure is thrown on after its notice, so the
   * editor's autosave shows its error state.
   */
  save: (todo: Held, payload: UpdateTodoPayload, apply: (saved: Todo, todo: Todo) => void | Promise<void>) => Promise<void>
  /**
   * Files the task under the viewer's own category. With `apply`, the task is read again and handed
   * over; a page that reads its task its own way (the branch page) leaves it out and reloads after.
   * A failure is thrown on after its notice, for the editor's autosave.
   */
  saveViewerCategory: (
    todo: Held,
    viewerCategoryId: string | null,
    apply?: (full: Todo, todo: Todo) => void | Promise<void>,
  ) => Promise<void>
  /**
   * Deletes a task behind the five-second window (`run` from the page's `useUndoableAction`)
   * instead of a confirmation: `take` removes it from the page at once, the DELETE is sent only
   * when the window closes, and `restore` puts it back on Undo or when the server refuses. `after`
   * runs once the server has deleted it.
   */
  removeWithUndo: (
    todo: Held,
    run: (action: PendingAction) => void,
    steps: { take: (todo: Todo) => void; restore: (todo: Todo) => void; after?: () => void | Promise<void> },
  ) => void
  /**
   * Deletes a task now — for a page that has already asked (the archive's dialog). `apply` runs once
   * the server has deleted it, before the notice.
   */
  remove: (todo: Held, apply?: () => void | Promise<void>) => Promise<void>
}

const isShared = (todo: Todo) => todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0

const statusOf = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status

/**
 * What a task's actions send and say, the same on every page that shows tasks (audit FE-24).
 *
 * Dashboard, Tasks, the archive, the branch page and the landing console each carried their own
 * copy of these handlers, and the copies had drifted: the same press sent different requests and
 * said different things depending on the page. The requests, the author-closed refusal and the
 * notices live here now; each page keeps only how a result lands in its own lists (`apply`) and
 * the rules and wording it has always had (`completion`, `work`), which name every remaining
 * difference.
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

    /** The owner's status change, answered with the task as the server now has it. */
    const putStatus = async (todo: Todo, status: "todo" | "inProgress" | "done") => {
      const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${todo.id}`, { status })
      return parseApiResponse(res.data)
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
          await apply({ via: "status", todo, reopened: done, updated: await putStatus(todo, done ? "todo" : "done") })
        }
        addToast({ type: "success", title: done ? "Task reopened" : "Task completed" })
      } catch (error) {
        log(viaViewer ? `Failed to ${verb} viewer completion:` : `Failed to ${verb} todo:`, error)
        // The server refuses a viewer's reopening of a task its author closed on either route.
        if (isAuthorAlreadyCompletedError(error)) addToast(AUTHOR_COMPLETED_TOAST)
        else fail("Couldn't update task", error)
      }
    }

    const startWork: TaskActions["startWork"] = async (todo, apply, { onFull } = {}) => {
      if (!todo) return
      const { viewerId, work = {}, addToast } = latest.current
      const startFailed = work.startFailed ?? "Couldn't update task"
      if (isTodoOwner(todo, viewerId)) {
        try {
          const updated = await putStatus(todo, "inProgress")
          await apply({ todo, via: "status", updated, patch: (t) => ({ ...t, status: "In Progress" }) })
        } catch (error) {
          fail(startFailed, error)
          return
        }
      } else {
        try {
          const updated = await joinTodo(todo.id)
          await apply({ todo, via: "worker", updated, patch: (t) => ({ ...t, ...updated }) })
        } catch (error) {
          if (!work.explainFull || statusOf(error) !== 409) {
            fail(work.joinFailed ?? startFailed, error)
            return
          }
          addToast({ type: "warning", title: "Task is full or you have already joined" })
          if (onFull) {
            try {
              onFull(await fetchTaskById(todo.id))
            } catch {
              // The card keeps what it has; the next load brings the rest.
            }
          }
          return
        }
      }
      if (work.started) addToast({ type: "success", title: work.started })
    }

    const stopWork: TaskActions["stopWork"] = async (todo, apply) => {
      if (!todo) return
      const { viewerId, work = {}, addToast } = latest.current
      const stopFailed = work.stopFailed ?? "Couldn't stop working"
      const owner = isTodoOwner(todo, viewerId)
      try {
        if (owner) {
          const updated = await putStatus(todo, "todo")
          await apply({ todo, via: "status", updated, patch: (t) => ({ ...t, status: "Todo" }) })
        } else {
          await leaveTodo(todo.id)
          await apply({
            todo,
            via: "worker",
            patch: (t) => ({ ...t, isWorking: false, workerCount: Math.max(0, (t.workerCount ?? 1) - 1) }),
          })
        }
      } catch (error) {
        fail(owner ? stopFailed : work.leaveFailed ?? stopFailed, error)
        return
      }
      if (work.stopped) addToast({ type: "success", title: work.stopped })
    }

    const duplicate: TaskActions["duplicate"] = async (
      todoId,
      apply,
      description = "A fresh copy was added to your active tasks.",
    ) => {
      if (!todoId) return
      try {
        const copy = await duplicateTodo(todoId)
        await apply?.(copy)
        latest.current.addToast({ type: "success", title: "Task duplicated", description })
      } catch (error) {
        log("Failed to duplicate todo:", error)
        fail("Couldn't duplicate task", error)
        throw error
      }
    }

    const save: TaskActions["save"] = async (todo, payload, apply) => {
      if (!todo) return
      try {
        const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${todo.id}`, {
          ...payload,
          status: toApiTodoStatus(todo.status),
        })
        const updated = parseApiResponse(res.data)
        // A success that carries no task would replace the card with nothing.
        if (!updated?.id) throw new Error("Invalid response from server")
        // The server echoes the old category when the editor clears it: show the clearing.
        await apply(applyCategoryPatch({ ...updated }, payload.categoryId), todo)
      } catch (error) {
        log("Failed to update todo:", error)
        fail("Couldn't save changes", error)
        throw error
      }
    }

    const saveViewerCategory: TaskActions["saveViewerCategory"] = async (todo, viewerCategoryId, apply) => {
      if (!todo) return
      try {
        await setViewerPreference(todo.id, { viewerCategoryId, updateViewerCategory: true })
        if (apply) await apply(await fetchTaskById(todo.id), todo)
      } catch (error) {
        log("Failed to update viewer preference:", error)
        fail("Couldn't save your category", error)
        throw error
      }
    }

    const removeWithUndo: TaskActions["removeWithUndo"] = (todo, run, { take, restore, after }) => {
      if (!todo) return
      take(todo)
      run({
        label: "Task deleted",
        commit: async () => {
          try {
            await api.delete(`/todos/api/v1/todos/${todo.id}`)
            await after?.()
          } catch (error) {
            log("Failed to delete todo:", error)
            fail("Couldn't delete task", error)
            // The server refused, so the card goes back rather than leave the user believing a
            // task is gone when it is not.
            restore(todo)
          }
        },
        rollback: () => restore(todo),
      })
    }

    const remove: TaskActions["remove"] = async (todo, apply) => {
      if (!todo) return
      try {
        await api.delete(`/todos/api/v1/todos/${todo.id}`)
        await apply?.()
        latest.current.addToast({ type: "success", title: "Task deleted" })
      } catch (error) {
        log("Failed to delete todo:", error)
        fail("Couldn't delete task", error)
      }
    }

    return { complete, startWork, stopWork, duplicate, save, saveViewerCategory, removeWithUndo, remove }
  }, [])
}
