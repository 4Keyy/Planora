"use client"

import Link from "next/link"
import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import { useCollapseScroll } from "@/hooks/use-collapse-scroll"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { CheckCircle2, ChevronRight, History, FolderOpen, Trash2 } from "lucide-react"
import { cn, truncateText } from "@/lib/utils"
import axios from "axios"
import { api, setTaskHidden, fetchTaskById, setViewerPreference, parseApiResponse, type ApiResponse, joinTodo, leaveTodo, duplicateTodo } from "@/lib/api"
import { ensureFriendNames } from "@/lib/friend-names"
import { isAuthorAlreadyCompletedError, AUTHOR_COMPLETED_TOAST } from "@/lib/errors"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Todo, PagedTodosResponse, type CreateTodoPayload, type UpdateTodoPayload, isCompletedTodoStatus, isTodoOwner, sameUserId, toApiTodoStatus } from "@/types/todo"
import { TodoCard } from "@/components/todos/todo-card"
import { MasonryColumns } from "@/components/ui/masonry-columns"
import { useToastStore } from "@/store/toast"
import { Category, type CategoryListResponse, toCategoryList } from "@/types/category"
import dynamic from "next/dynamic"
// Heavy task-editing components are lazy-loaded: they only mount when the user
// opens the create panel or clicks edit on a card, so deferring their JS
// shrinks the tasks page's First Load by ~30 kB without changing the visible
// flow (the framer-motion enter animation absorbs the ~50 ms chunk fetch).
const EditTodoModal = dynamic(
  () => import("@/components/todos/edit-todo-modal").then((m) => ({ default: m.EditTodoModal })),
  { ssr: false },
)
const CreateTodoPanel = dynamic(
  () => import("@/components/todos/create-todo-panel").then((m) => ({ default: m.CreateTodoPanel })),
  {
    ssr: false,
    // The panel's collapsed header is now always on screen (it IS the "new task"
    // affordance), so reserve its footprint while the chunk streams in to avoid
    // a layout pop.
    loading: () => (
      <div className="h-[84px] rounded-xl border border-line/80 bg-paper shadow-sm" aria-hidden="true" />
    ),
  },
)
import { sortTasks, getTaskWeight } from "@/utils/sort-tasks"
import { applyCategoryPatch } from "@/utils/todo-utils"
import { TASK_CREATED_EVENT, type TaskCreatedDetail } from "@/lib/events"
import { useFeedSync } from "@/lib/realtime/hooks"
import { EASE_OUT_EXPO, SPRING_GENTLE } from "@/lib/animations"
import { readFilter, writeFilter } from "@/utils/category-filter"
import { CategoryFilterModal } from "@/components/todos/category-filter-modal"
import { QuickFilterBar } from "@/components/todos/quick-filter-bar"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { StatusPanel } from "@/components/ui/status-panel"
import { NumberRoll } from "@/components/ui/number-roll"
import { UndoBar, useUndoableAction } from "@/components/ui/undo-bar"
import { useListNavigation } from "@/hooks/use-list-navigation"
import { rememberOrigin } from "@/lib/shared-origin"
import { todoToOwnerPayload } from "@/components/todos/edit-todo-modal/utils"
import { SelectionBar } from "@/components/ui/selection-bar"
import { QuickCapture } from "@/components/todos/quick-capture"
import { UpdatePill, useDeferredUpdates } from "@/components/ui/update-pill"

const ACTIVE_PAGE_SIZE = 200
const COMPLETED_PREVIEW_SIZE = 20
// PERF: the active feed keeps the "all tasks in one scroll" UX, but only mounts
// a window of cards into the DOM. TodoCard is expensive, so mounting hundreds at
// once is what made this page lag. We render an initial batch and grow it as the
// user scrolls (IntersectionObserver sentinel), capping mounted cards regardless
// of how many tasks exist. Data is still fetched in full so client-side category
// filtering stays instant.
const INITIAL_VISIBLE_TASKS = 24
const VISIBLE_TASKS_CHUNK = 24
const TODO_MASONRY_BREAKPOINTS = [
  { maxWidth: 1400, columns: 3 },
  { maxWidth: 900, columns: 2 },
  { maxWidth: 480, columns: 1 },
]
const EMPTY_USER_ID = "00000000-0000-0000-0000-000000000000"

/**
 * Header count pill ("5 active" / "2 done"). The number crossfades vertically
 * on change so live updates read as a counter roll, never a hard swap.
 */
function StatusPill({ count, label, emphasis }: { count: number; label: string; emphasis?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
      className={cn(
        "flex items-center gap-2 rounded-full border bg-paper px-4 py-2 shadow-sm",
        emphasis ? "border-line" : "border-line",
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", emphasis ? "bg-ink" : "bg-gray-300")} />
      {/* Was a single column that swapped the whole number; now every digit rolls on
          its own, so 9 → 10 grows a column instead of replacing a glyph.

          `minDigits={2}` is a layout guarantee, not padding. These pills start at
          `0` while the list loads and settle on a real count, and on a 390px screen
          that one extra digit was enough to push this header past its wrap point:
          the title row went to two lines and everything below it jumped 54px —
          0.119 CLS, the worst cell in the matrix. Layout is decided by the
          viewport; it is never allowed to be decided by the data. */}
      <NumberRoll
        value={count}
        minDigits={2}
        className={cn("text-body-sm font-bold", emphasis ? "text-ink" : "text-ink-subtle")}
      />
      <span className={cn("text-body-sm font-bold", emphasis ? "text-ink" : "text-ink-subtle")}>{label}</span>
    </motion.div>
  )
}

const redactHiddenSharedTodo = (todo: Todo): Todo => ({
  ...todo,
  userId: EMPTY_USER_ID,
  title: "Hidden task",
  description: null,
  status: "",
  dueDate: null,
  expectedDate: null,
  actualDate: null,
  priority: "",
  isPublic: false,
  isCompleted: false,
  completedAt: null,
  isOnTime: null,
  delay: null,
  tags: [],
  sharedWithUserIds: [],
})

export default function TasksPage() {
  const router = useRouter()
  const addToast = useToastStore((s) => s.addToast)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const hasHydrated = useAuthStore(s => s.hasHydrated)
  const user = useAuthStore(s => s.user)

  const [todos, setTodos] = useState<Todo[]>([])
  const [completedPreview, setCompletedPreview] = useState<Todo[]>([])
  const [completedTotalCount, setCompletedTotalCount] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [completedLoading, setCompletedLoading] = useState(false)

  const friendNameCache = useRef<Map<string, string>>(new Map())

  // PERF: live mirrors of the lists for the memoized TodoCard's (possibly stale)
  // handler closures to read from. See the equivalent note on the dashboard.
  const todosRef = useRef(todos)
  const completedPreviewRef = useRef(completedPreview)
  todosRef.current = todos
  completedPreviewRef.current = completedPreview

  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  /** Deletions wait five seconds in here instead of behind a confirmation dialog. */
  const undoable = useUndoableAction()
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([])
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)

  /**
   * Whether the list itself has the screen.
   *
   * One flag, three consumers, because they are all asking the same question and
   * must not be able to answer it differently: the keyboard detaches, the capture
   * bubble hides so it cannot float over a backdrop or be reached by Tab from
   * behind one, and realtime updates queue instead of landing under a dialog the
   * user is reading.
   */
  const listKeysEnabled = !editingTodo && !isCreateOpen && !isCategoryModalOpen

  // Smooth scroll to top when large panels collapse
  useCollapseScroll(isCreateOpen)
  useCollapseScroll(showCompleted)

  // Hydrate the persisted category filter per-user. Re-reads whenever the active
  // user changes (e.g. switching accounts), so a filter never leaks across accounts
  // while each user's own filter survives a hard refresh.
  useEffect(() => {
    setFilterCategoryIds(readFilter(user?.userId))
  }, [user?.userId])

  // Press "F" — toggle category filter modal (skip when typing in inputs). The filter plate is
  // always on screen now, so the shortcut works whether or not the create panel is expanded.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f") return
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return
      e.preventDefault()
      setIsCategoryModalOpen(prev => !prev)
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [])


  /*
   * Warm the editor chunk once the page is idle. It stays code-split — the First
   * Load payload is unchanged — but the fetch no longer sits between the press and
   * the dialog. That matters for more than latency: the card-to-dialog transition
   * animates from a rect captured at press time, and a rect older than a second is
   * discarded as stale (lib/shared-origin.ts), so a cold chunk fetch would silently
   * cost the first open of every session its transition.
   */
  useEffect(() => {
    const warm = () => { void import("@/components/todos/edit-todo-modal") }
    const idle = window.requestIdleCallback
    if (typeof idle === "function") {
      const handle = idle(warm, { timeout: 2000 })
      return () => window.cancelIdleCallback?.(handle)
    }
    const t = window.setTimeout(warm, 1200)
    return () => window.clearTimeout(t)
  }, [])

  const handleFilterChange = useCallback((ids: string[]) => {
    setFilterCategoryIds(ids)
    writeFilter(user?.userId, ids)
  }, [user?.userId])

  const fetchCategories = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await api.get<ApiResponse<CategoryListResponse>>("/categories/api/v1/categories", { signal })
      setCategories(toCategoryList(parseApiResponse<CategoryListResponse>(res.data)))
    } catch (error) {
      if (axios.isCancel(error) || signal?.aborted) return
      console.error("Failed to fetch categories:", error)
    }
  }, [])

  const enrichTodosWithAuthorNames = useCallback(async (items: Todo[]) => {
    const currentUserId = user?.userId
    if (!currentUserId) return items

    const friendIds = new Set(
      items
        .filter((t) => {
          if (!t.userId || sameUserId(t.userId, currentUserId)) return false
          const isFriendVisible = t.isPublic || (t.sharedWithUserIds?.length ?? 0) > 0
          return isFriendVisible
        })
        .map((t) => t.userId)
    )

    if (friendIds.size === 0) return items

    await ensureFriendNames(friendIds, friendNameCache.current)

    if (friendNameCache.current.size === 0) return items

    return items.map((t) => {
      if (!t.userId || sameUserId(t.userId, currentUserId)) return t
      const isFriendVisible = t.isPublic || (t.sharedWithUserIds?.length ?? 0) > 0
      if (!isFriendVisible) return t
      const authorName = friendNameCache.current.get(t.userId)
      return authorName ? { ...t, authorName } : t
    })
  }, [user?.userId])

  const fetchActiveTodos = useCallback(async ({ signal, silent = false }: { signal?: AbortSignal; silent?: boolean } = {}) => {
    // Mutation-triggered refreshes pass silent:true so the list reconciles in the
    // background without flashing the skeleton grid over cards already on screen.
    if (!silent) setLoading(true)
    try {
      const all: Todo[] = []
      let page = 1
      let totalCount: number | null = null

      while (true) {
        if (signal?.aborted) return
        const res = await api.get<PagedTodosResponse>("/todos/api/v1/todos", {
          params: { pageNumber: page, pageSize: ACTIVE_PAGE_SIZE, isCompleted: false },
          signal,
        })
        const items = res.data.items ?? []
        const nextTotal = res.data.totalCount

        all.push(...items)
        if (typeof nextTotal === "number") {
          totalCount = nextTotal
        }

        if (items.length === 0) break
        if (totalCount !== null && all.length >= totalCount) break
        if (items.length < ACTIVE_PAGE_SIZE) break

        page += 1
        if (page > 100) break
      }

      if (signal?.aborted) return
      const enriched = await enrichTodosWithAuthorNames(all)
      if (signal?.aborted) return
      setTodos(enriched)
    } catch (error) {
      if (axios.isCancel(error) || signal?.aborted) return
      console.error("Failed to fetch active todos:", error)
      // A silent background reconcile must not surface a toast — the cards already
      // on screen stay valid; only an interactive (non-silent) load reports failure.
      if (!silent) addToast({ type: "error", title: "Failed to load tasks" })
    } finally {
      if (!silent && !signal?.aborted) setLoading(false)
    }
  }, [addToast, enrichTodosWithAuthorNames])

  const fetchCompletedPreview = useCallback(async (signal?: AbortSignal) => {
    setCompletedLoading(true)
    try {
      const res = await api.get<PagedTodosResponse>("/todos/api/v1/todos", {
        params: { pageNumber: 1, pageSize: COMPLETED_PREVIEW_SIZE, isCompleted: true },
        signal,
      })
      if (signal?.aborted) return
      const items = res.data.items ?? []
      const enriched = await enrichTodosWithAuthorNames(items)
      if (signal?.aborted) return
      setCompletedPreview(enriched)
      setCompletedTotalCount(res.data.totalCount ?? enriched.length)
    } catch (error) {
      if (axios.isCancel(error) || signal?.aborted) return
      console.error("Failed to fetch completed preview:", error)
      setCompletedPreview([])
      setCompletedTotalCount(0)
    } finally {
      if (!signal?.aborted) setCompletedLoading(false)
    }
  }, [enrichTodosWithAuthorNames])

  useEffect(() => {
    if (!hasHydrated) return

    if (!isAuthenticated || !useAuthStore.getState().isTokenValid()) {
      clearAuth()
      router.replace("/auth/login")
      return
    }

    // Cancel all in-flight mount-time fetches on unmount or auth change so a
    // rapid route switch does not leave stale fetches racing to setState on an
    // unmounted component.
    const controller = new AbortController()
    void Promise.all([
      fetchActiveTodos({ signal: controller.signal }),
      fetchCompletedPreview(controller.signal),
      fetchCategories(controller.signal),
    ])
    return () => controller.abort()
  }, [isAuthenticated, hasHydrated, router, fetchActiveTodos, fetchCompletedPreview, fetchCategories, clearAuth])

  useEffect(() => {
    const handler = (e: Event) => {
      const created = (e as CustomEvent<TaskCreatedDetail>).detail?.todo
      // Render the new task instantly, then reconcile silently in the background.
      if (created?.id) {
        setTodos((prev) => prev.some((t) => t.id === created.id) ? prev : [created, ...prev])
      }
      void fetchActiveTodos({ silent: true })
    }
    window.addEventListener(TASK_CREATED_EVENT, handler)
    return () => window.removeEventListener(TASK_CREATED_EVENT, handler)
  }, [fetchActiveTodos])

  // ── Live cross-user sync ──────────────────────────────────────────────────
  // A friend created/updated/deleted/completed a task we can see. Reconcile the single affected
  // task against the authoritative endpoint so the feed updates instantly — no full refetch, no
  // flicker. Our own echoes are ignored: the local optimistic update already applied them.
  const reconcileTaskById = useCallback(async (taskId: string) => {
    let fresh: Todo | null = null
    try {
      fresh = await fetchTaskById(taskId)
    } catch {
      fresh = null
    }

    // Lost access (un-shared / un-published / deleted) → drop the card everywhere.
    if (!fresh) {
      setTodos((prev) => prev.filter((t) => t.id !== taskId))
      setCompletedPreview((prev) => prev.filter((t) => t.id !== taskId))
      return
    }

    const authorName = fresh.authorName ?? friendNameCache.current.get(fresh.userId)
    const [enriched] = authorName ? [{ ...fresh, authorName }] : await enrichTodosWithAuthorNames([fresh])
    const upsert = (prev: Todo[]) =>
      prev.some((t) => t.id === taskId)
        ? prev.map((t) => (t.id === taskId ? enriched : t))
        : [enriched, ...prev]

    if (isCompletedTodoStatus(enriched.status)) {
      setTodos((prev) => prev.filter((t) => t.id !== taskId))
      setCompletedPreview(upsert)
      // A task transitioning INTO completed bumps the "done" count — refresh it authoritatively
      // (only on the transition, not on edits of an already-completed task) so the badge stays honest.
      if (!completedPreviewRef.current.some((t) => t.id === taskId)) {
        void fetchCompletedPreview()
      }
    } else {
      setCompletedPreview((prev) => prev.filter((t) => t.id !== taskId))
      setTodos(upsert)
    }
  }, [enrichTodosWithAuthorNames, fetchCompletedPreview])

  /**
   * Somebody else's change, offered rather than applied.
   *
   * Reconciling on arrival moved every card below the insertion point — under a
   * pointer that was already aimed, and under a reading position the user had
   * scrolled to. The queue holds the change until it is safe: at the top of the
   * list, with no dialog or composer open. See components/ui/update-pill.tsx for
   * the policy; this decides only what "busy" means on this page.
   */
  const incoming = useDeferredUpdates<string>({
    busy: !listKeysEnabled,
    onApply: useCallback((taskIds: string[]) => {
      // De-duplicated: three edits to one task while the queue was held is still
      // one task to re-read, and three refetches would race each other's writes.
      for (const id of new Set(taskIds)) void reconcileTaskById(id)
    }, [reconcileTaskById]),
  })

  useFeedSync(useCallback((signal) => {
    if (sameUserId(signal.actorId, user?.userId)) return
    if (signal.action === "task.deleted") {
      // A deletion is NOT deferred. Leaving a card the user can press for a task
      // that no longer exists earns them a 404 for doing the obvious thing;
      // removal also only ever shortens the list, so nothing slides under the
      // pointer the way an insert does.
      setTodos((prev) => prev.filter((t) => t.id !== signal.taskId))
      setCompletedPreview((prev) => prev.filter((t) => t.id !== signal.taskId))
      // Keep the completed count badge honest after a remote delete.
      void fetchCompletedPreview()
      return
    }
    incoming.push(signal.taskId)
  }, [incoming, fetchCompletedPreview, user?.userId]))

  const handleComplete = async (id: string) => {
    const existingTodo = todosRef.current.find((t) => t.id === id) ?? completedPreviewRef.current.find((t) => t.id === id)
    if (!existingTodo) return

    const currentUserId = user?.userId
    const isOwner = isTodoOwner(existingTodo, currentUserId)
    const isShared = existingTodo.isPublic || (existingTodo.sharedWithUserIds?.length ?? 0) > 0

    if (!isOwner && isShared) {
      const wasCompleted = existingTodo.isCompletedByViewer === true
      // Once the author closes the whole task globally it is done for EVERYONE: block any non-owner
      // toggle up-front (regardless of their per-viewer state) so the "can't restore" toast fires
      // immediately instead of after a premature "Task completed!".
      if (existingTodo.ownerCompleted === true) {
        addToast(AUTHOR_COMPLETED_TOAST)
        return
      }
      try {
        const result = await setViewerPreference(id, { completedByViewer: !wasCompleted })
        setTodos((prev) => prev.map((t) =>
          t.id !== id ? t : { ...t, isCompletedByViewer: result.completedByViewer ?? false, ownerCompleted: result.ownerCompleted }
        ))
        if (!wasCompleted) {
          setTodos((prev) => prev.filter((t) => t.id !== id))
          await fetchCompletedPreview()
        } else {
          await Promise.all([fetchActiveTodos({ silent: true }), fetchCompletedPreview()])
        }
        addToast({ type: "success", title: wasCompleted ? "Task reopened!" : "Task completed!" })
      } catch (error) {
        console.error("Failed to update viewer completion:", error)
        if (isAuthorAlreadyCompletedError(error)) {
          addToast(AUTHOR_COMPLETED_TOAST)
        } else {
          addToast({ type: "error", title: "Failed to update task" })
        }
      }
      return
    }

    const isCompleted = isCompletedTodoStatus(existingTodo.status)
    const newStatus = isCompleted ? "todo" : "done"

    try {
      await api.put(`/todos/api/v1/todos/${id}`, { status: newStatus })

      if (isCompleted) {
        await Promise.all([fetchActiveTodos({ silent: true }), fetchCompletedPreview()])
      } else {
        setTodos((prev) => prev.filter((t) => t.id !== id))
        await fetchCompletedPreview()
      }

      addToast({
        type: "success",
        title: isCompleted ? "Task reopened!" : "Task completed!",
      })
    } catch (error) {
      console.error("Failed to update todo:", error)
      addToast({ type: "error", title: "Failed to update task" })
    }
  }

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateTodo(id)
      await fetchActiveTodos({ silent: true })
      addToast({ type: "success", title: "Task duplicated", description: "A fresh copy was added to your active tasks." })
    } catch (error) {
      console.error("Failed to duplicate todo:", error)
      addToast({ type: "error", title: "Failed to duplicate task" })
      throw error
    }
  }

  /**
   * Delete with an undo window instead of a confirmation.
   *
   * The card leaves the list immediately; the DELETE is only sent once the window
   * closes. Undo cancels the timer, so nothing ever reaches the server — which is
   * what makes this honest, since the API has no restore endpoint to put the task
   * back with.
   */
  const requestDelete = (todo: Todo) => {
    const wasCompleted = isCompletedTodoStatus(todo.status)
    // Remember where it was, so undo puts it back in place rather than on top.
    const index = todos.findIndex((t) => t.id === todo.id)

    if (!wasCompleted) setTodos((prev) => prev.filter((t) => t.id !== todo.id))

    undoable.run({
      label: `“${todo.title.length > 40 ? `${todo.title.slice(0, 40)}…` : todo.title}” deleted`,
      commit: async () => {
        try {
          await api.delete(`/todos/api/v1/todos/${todo.id}`)
          if (wasCompleted) await fetchCompletedPreview()
        } catch (error) {
          console.error("Failed to delete todo:", error)
          addToast({ type: "error", title: "Failed to delete task" })
          // The server refused, so put the card back rather than leave the user
          // believing a task is gone when it is not.
          if (!wasCompleted) {
            setTodos((prev) => {
              if (prev.some((t) => t.id === todo.id)) return prev
              const next = [...prev]
              next.splice(index < 0 ? next.length : index, 0, todo)
              return next
            })
          }
        }
      },
      rollback: () => {
        if (wasCompleted) return
        setTodos((prev) => {
          if (prev.some((t) => t.id === todo.id)) return prev
          const next = [...prev]
          next.splice(index < 0 ? next.length : index, 0, todo)
          return next
        })
      },
    })
  }

  const handleUpdate = async (id: string, payload: UpdateTodoPayload) => {
    try {
      const existingTodo = todos.find((t) => t.id === id) ?? completedPreview.find((t) => t.id === id)
      if (!existingTodo) return

      const res = await api.put(`/todos/api/v1/todos/${id}`, {
        ...payload,
        status: toApiTodoStatus(existingTodo.status),
      })

      const updatedTodo = parseApiResponse<Todo>(res.data)
      if (!updatedTodo || !updatedTodo.id) {
        throw new Error("Invalid response from server")
      }

      const authorName = existingTodo.authorName ?? friendNameCache.current.get(updatedTodo.userId)
      const nextTodo = { ...applyCategoryPatch({ ...updatedTodo }, payload.categoryId), authorName }

      if (isCompletedTodoStatus(existingTodo.status)) {
        setCompletedPreview((prev) => prev.map((t) => (t.id === id ? nextTodo : t)))
      } else {
        setTodos((prev) => prev.map((t) => (t.id === id ? nextTodo : t)))
      }

      // Autosave path: keep the modal open and stay quiet — the in-modal AutosaveIndicator
      // reports success. We intentionally do not refresh `editingTodo` so the open modal's
      // local field state (the source of truth while editing) is never clobbered mid-edit.
    } catch (error) {
      console.error("Failed to update todo:", error)
      addToast({ type: "error", title: "Failed to save changes" })
      // Re-throw so the modal's autosave surfaces the error state and retries on next edit.
      throw error
    }
  }

  const handleSaveViewerPreference = async (id: string, viewerCategoryId: string | null) => {
    try {
      const existingTodo = todos.find((t) => t.id === id) ?? completedPreview.find((t) => t.id === id)
      if (!existingTodo) return

      await setViewerPreference(id, {
        viewerCategoryId,
        updateViewerCategory: true,
      })

      const fullTask = await fetchTaskById(id)
      const authorName = existingTodo.authorName ?? friendNameCache.current.get(fullTask.userId)
      const nextTodo = authorName ? { ...fullTask, authorName } : fullTask

      if (isCompletedTodoStatus(existingTodo.status)) {
        setCompletedPreview((prev) => prev.map((t) => (t.id === id ? nextTodo : t)))
      } else {
        setTodos((prev) => prev.map((t) => (t.id === id ? nextTodo : t)))
      }

      // Autosave path: stay open and quiet; the modal's AutosaveIndicator confirms the save.
    } catch (error) {
      console.error("Failed to update viewer preference:", error)
      addToast({ type: "error", title: "Failed to save your category" })
      throw error // surface error state in the modal's autosave indicator
    }
  }

  const handleCreate = async (payload: CreateTodoPayload) => {
    try {
      const res = await api.post<ApiResponse<Todo>>("/todos/api/v1/todos", payload)
      setIsCreateOpen(false)
      addToast({ type: "success", title: "Task created!" })
      // Show the new task immediately, then reconcile against the server in the
      // background so the list never blanks out behind a skeleton.
      const created = parseApiResponse<Todo>(res.data)
      if (created?.id) {
        const [enriched] = await enrichTodosWithAuthorNames([created])
        setTodos((prev) => prev.some((t) => t.id === created.id) ? prev : [enriched, ...prev])
      }
      // Reconcile in the background — don't block the create panel's field reset on the refetch.
      void fetchActiveTodos({ silent: true })
    } catch (error) {
      console.error("Failed to create todo:", error)
      addToast({ type: "error", title: "Failed to create task" })
    }
  }

  /**
   * The capture path: a title and nothing else.
   *
   * It deliberately does NOT reuse `handleCreate`, for one reason that matters —
   * `handleCreate` catches its own failure and raises a toast. `QuickCapture` keeps
   * the typed text and shows the error inline only if the promise rejects, so
   * swallowing the error here would clear the field and lose the thought the user
   * had just stopped to write down. The rejection is the contract.
   */
  const handleQuickCapture = useCallback(async (title: string) => {
    const res = await api.post<ApiResponse<Todo>>("/todos/api/v1/todos", { title })
    const created = parseApiResponse<Todo>(res.data)
    if (created?.id) {
      const [enriched] = await enrichTodosWithAuthorNames([created])
      setTodos((prev) => (prev.some((t) => t.id === created.id) ? prev : [enriched, ...prev]))
    }
    void fetchActiveTodos({ silent: true })
  }, [enrichTodosWithAuthorNames, fetchActiveTodos])

  /**
   * Delete a whole selection under ONE undo window.
   *
   * Looping `requestDelete` would be the obvious implementation and it is wrong:
   * `useUndoableAction` holds a single pending action and commits the previous one
   * whenever a new one starts, so ten calls would commit nine deletions instantly
   * and leave a window over only the last. Building one action that carries every
   * id keeps the promise the bar makes — the whole batch is reversible, or none of
   * it is.
   */
  const requestDeleteMany = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const snapshot = todosRef.current
    // Positions from the list as it stands, so undo restores the order rather than
    // dropping everything back on top.
    const removed = ids
      .map((id) => ({ index: snapshot.findIndex((t) => t.id === id), todo: snapshot.find((t) => t.id === id) }))
      .filter((entry): entry is { index: number; todo: Todo } => entry.todo !== undefined)
      .sort((a, b) => a.index - b.index)
    if (removed.length === 0) return

    const gone = new Set(removed.map((r) => r.todo.id))
    setTodos((prev) => prev.filter((t) => !gone.has(t.id)))

    const restore = () =>
      setTodos((prev) => {
        const next = [...prev]
        // Ascending, so each insertion index is still valid once the earlier ones
        // have been put back.
        for (const { index, todo } of removed) {
          if (next.some((t) => t.id === todo.id)) continue
          next.splice(index < 0 || index > next.length ? next.length : index, 0, todo)
        }
        return next
      })

    undoable.run({
      label: removed.length === 1
        ? `“${truncateText(removed[0].todo.title, 40)}” deleted`
        : `${removed.length} tasks deleted`,
      commit: async () => {
        const results = await Promise.allSettled(
          removed.map((r) => api.delete(`/todos/api/v1/todos/${r.todo.id}`)),
        )
        const failed = removed.filter((_, i) => results[i].status === "rejected")
        if (failed.length === 0) return
        // Partial failure puts back exactly the ones that are still there. Telling
        // the user "some failed" while showing them gone is the worst of both.
        addToast({
          type: "error",
          title: failed.length === removed.length
            ? "Failed to delete the tasks"
            : `${failed.length} of ${removed.length} could not be deleted`,
        })
        setTodos((prev) => {
          const next = [...prev]
          for (const { index, todo } of failed) {
            if (next.some((t) => t.id === todo.id)) continue
            next.splice(index < 0 || index > next.length ? next.length : index, 0, todo)
          }
          return next
        })
      },
      rollback: restore,
    })
  }, [undoable, addToast])

  const handleToggleHidden = useCallback(async (todoId: string) => {
    const existing = todosRef.current.find(t => t.id === todoId) ?? completedPreviewRef.current.find(t => t.id === todoId)
    if (!existing) return
    const newHidden = !(existing.hidden ?? false)
    const isOwner = isTodoOwner(existing, user?.userId)
    const canOptimisticallyToggle = isOwner || newHidden

    const optimistic = (prev: Todo[]) =>
      prev.map(t => t.id === todoId ? { ...t, hidden: newHidden } : t)
    if (canOptimisticallyToggle) {
      setTodos(optimistic)
      setCompletedPreview(optimistic)
    }

    try {
      if (isOwner) {
        const response = await setTaskHidden(todoId, newHidden)

        const mergeResponse = (prev: Todo[]) =>
          prev.map(t =>
            t.id === todoId
              ? {
                  ...t,
                  hidden: response.hidden,
                  categoryName: response.categoryName ?? t.categoryName,
                  categoryId: response.categoryId ?? t.categoryId,
                }
              : t
          )
        setTodos(mergeResponse)
        setCompletedPreview(mergeResponse)

        if (!newHidden) {
          const fullTask = await fetchTaskById(todoId)
          const authorName = friendNameCache.current.get(fullTask.userId)
          const enriched = authorName ? { ...fullTask, authorName, hidden: false } : { ...fullTask, hidden: false }
          setTodos(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
          setCompletedPreview(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
        }
      } else {
        await setViewerPreference(todoId, { hiddenByViewer: newHidden })

        if (newHidden) {
          setTodos(prev => prev.map(t => t.id === todoId ? redactHiddenSharedTodo(t) : t))
          setCompletedPreview(prev => prev.map(t => t.id === todoId ? redactHiddenSharedTodo(t) : t))
        } else {
          const fullTask = await fetchTaskById(todoId)
          const authorName = friendNameCache.current.get(fullTask.userId)
          const enriched = authorName ? { ...fullTask, authorName, hidden: false } : { ...fullTask, hidden: false }
          setTodos(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
          setCompletedPreview(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
        }
      }
    } catch {
      if (canOptimisticallyToggle) {
        const revert = (prev: Todo[]) =>
          prev.map(t => t.id === todoId ? { ...t, hidden: !newHidden } : t)
        setTodos(revert)
        setCompletedPreview(revert)
      }
      addToast({ type: "error", title: "Failed to update task visibility" })
    }
  }, [user?.userId, addToast])

  const activeCount = todos.filter(t => t.isCompletedByViewer !== true).length
  const doneCount = completedTotalCount
  const totalCount = activeCount + doneCount

  const sortedTodos = useMemo(() => {
    const filtered = todos.filter(t => t.isCompletedByViewer !== true)
    return sortTasks(filtered)
  }, [todos])

  const sortedCompletedPreview = useMemo(() => sortTasks(completedPreview), [completedPreview])
  const visibleTodos = useMemo(() => {
    if (filterCategoryIds.length === 0) return sortedTodos
    return sortedTodos.filter(t => filterCategoryIds.includes(t.categoryId ?? ""))
  }, [sortedTodos, filterCategoryIds])

  // PERF: progressive mounting window over the active feed (see constants above).
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_TASKS)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  // Reset the window only on an intentional context switch (filter change). We
  // deliberately do NOT reset on data mutations, so an optimistic update (e.g.
  // completing one task) never collapses the user's scroll position.
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_TASKS)
  }, [filterCategoryIds])

  const renderedTodos = useMemo(
    () => visibleTodos.slice(0, visibleCount),
    [visibleTodos, visibleCount],
  )
  const hasMoreTodos = visibleCount < visibleTodos.length

  // ── The keyboard ───────────────────────────────────────────────────────────
  /*
   * The cursor covers the MOUNTED window, not the whole filtered list. Letting it
   * address a task that has not been rendered yet would mean `j` walking off the
   * bottom into rows with no element to scroll to and no card to outline — the
   * cursor would appear to vanish. The window grows as the user scrolls, so the
   * reachable set grows with it.
   */
  const navIds = useMemo(() => renderedTodos.map((t) => t.id), [renderedTodos])


  const nav = useListNavigation({
    ids: navIds,
    enabled: listKeysEnabled,
    onActivate: (id) => {
      const todo = todosRef.current.find((t) => t.id === id)
      if (!todo) return
      // Hand over the same rect a click would have, so Enter and a pointer open
      // the editor identically. See lib/shared-origin.ts.
      rememberOrigin(nav.getRowNode(id))
      setEditingTodo(todo)
    },
    onEdit: (id) => {
      const todo = todosRef.current.find((t) => t.id === id)
      if (!todo) return
      rememberOrigin(nav.getRowNode(id))
      setEditingTodo(todo)
    },
    onToggleComplete: (id) => { void handleComplete(id) },
    onDelete: (id) => {
      const todo = todosRef.current.find((t) => t.id === id)
      if (todo) requestDelete(todo)
    },
    onPriority: (id, level) => {
      const todo = todosRef.current.find((t) => t.id === id)
      if (!todo) return
      // Only the owner may re-prioritise; a shared viewer pressing `3` would get a
      // 403 and a toast for a key they were never offered.
      if (!isTodoOwner(todo, user?.userId)) return
      // The whole task, not `{ priority }` — the endpoint is a PUT, so a partial
      // body clears every field it omits. See todoToOwnerPayload.
      void handleUpdate(id, { ...todoToOwnerPayload(todo), priority: level })
    },
  })

  useEffect(() => {
    if (!hasMoreTodos) return
    const el = loadMoreRef.current
    if (!el) return
    // Pre-load the next batch ~600px before the sentinel reaches the viewport so
    // new cards are mounted by the time the user scrolls to them (no blank gap).
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + VISIBLE_TASKS_CHUNK)
        }
      },
      { rootMargin: "600px 0px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMoreTodos])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
            className="mb-1.5 text-caption font-bold uppercase tracking-[0.3em] text-ink-subtle"
          >
            Workspace
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: 0.04, ease: EASE_OUT_EXPO }}
            className="text-display-sm font-bold leading-none tracking-tight text-ink sm:text-display"
          >
            Tasks
          </motion.h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill count={activeCount} label="active" emphasis />
          <StatusPill count={doneCount} label="done" />
        </div>
      </div>

      {/* The redesigned control deck: the create panel and the quick-filter plate are BOTH always
          on screen — the panel's own collapsed header is the "new task" affordance and expands in
          place. Create sits above the filter (task creation is the primary action of this page). */}
      <CreateTodoPanel
        isOpen={isCreateOpen}
        onToggle={() => setIsCreateOpen((prev) => !prev)}
        categories={categories}
        onSubmit={handleCreate}
        onCreateCategory={fetchCategories}
        onDeleteCategory={async (id) => {
          await api.delete(`/categories/api/v1/categories/${id}`)
          await fetchCategories()
          await fetchActiveTodos()
          await fetchCompletedPreview()
        }}
      />
      <QuickFilterBar
        categories={categories}
        selectedIds={filterCategoryIds}
        onOpen={() => setIsCategoryModalOpen(true)}
        onClear={() => handleFilterChange([])}
      />

      {loading ? (
        <MasonryColumns
          items={[...Array(6)].map((_, i) => ({ id: `skeleton-${i}` }))}
          getKey={(item) => item.id}
          renderItem={() => <TodoSkeleton />}
          columns={4}
          breakpoints={TODO_MASONRY_BREAKPOINTS}
        />
      ) : totalCount === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ ...SPRING_GENTLE, delay: 0.1 }}
        >
          <StatusPanel
            icon={CheckCircle2}
            title="No tasks yet"
            description="Create your first task to get started."
            action={{ label: "Create task", onClick: () => setIsCreateOpen(true) }}
          />
        </motion.div>
      ) : (
        <div className="space-y-10">
          <div>
            {visibleTodos.length === 0 ? (
              filterCategoryIds.length > 0 ? (
                <StatusPanel
                  size="compact"
                  as="p"
                  icon={FolderOpen}
                  title="No tasks in the selected categories"
                  description="Nothing here matches the filter. Widen it, or clear it to see everything."
                  action={{ label: "Clear filter", onClick: () => handleFilterChange([]) }}
                />
              ) : (
                <StatusPanel size="compact" as="p" icon={CheckCircle2} title="No active tasks" />
              )
            ) : (
              <>
              {/* Held realtime changes, offered above the list they would have
                  moved. Renders nothing while the queue is empty. */}
              <UpdatePill count={incoming.count} onShow={incoming.show} noun="update" />
              <MasonryColumns
                items={renderedTodos}
                getKey={(todo) => todo.id}
                getItemWeight={getTaskWeight}
                columns={4}
                breakpoints={TODO_MASONRY_BREAKPOINTS}
                renderItem={(todo) => (
                  <TodoCard
                    todo={todo}
                    variant="default"
                    rowProps={nav.getRowProps(todo.id)}
                    onComplete={() => handleComplete(todo.id)}
                    onDelete={() => requestDelete(todo)}
                    onEdit={() => setEditingTodo(todo)}
                    onToggleHidden={() => handleToggleHidden(todo.id)}
                    onJoin={async () => {
                      if (isTodoOwner(todo, user?.userId)) {
                        try {
                          await api.put(`/todos/api/v1/todos/${todo.id}`, { status: "inProgress" })
                          setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, status: "In Progress" } : t))
                          setCommentsRefreshKey((k) => k + 1)
                        } catch {
                          addToast({ type: "error", title: "Could not update task" })
                        }
                      } else {
                        try {
                          const updated = await joinTodo(todo.id)
                          setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, ...updated } : t))
                          setCommentsRefreshKey((k) => k + 1)
                        } catch (err: unknown) {
                          const status = (err as { response?: { status: number } })?.response?.status
                          if (status === 409) {
                            addToast({ type: "warning", title: "Task is full or you have already joined" })
                            try {
                              const fresh = await fetchTaskById(todo.id)
                              setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, ...fresh } : t))
                            } catch { /* ignore refetch failure */ }
                          } else {
                            addToast({ type: "error", title: "Could not join task" })
                          }
                        }
                      }
                    }}
                  />
                )}
              />
              {hasMoreTodos && (
                <div
                  ref={loadMoreRef}
                  aria-hidden="true"
                  className="h-6 w-full"
                />
              )}
              </>
            )}
          </div>

          {completedTotalCount > 0 && (
            <div className="space-y-4">
              <button
                onClick={() => setShowCompleted((prev) => !prev)}
                className="touch-target flex min-h-control items-center gap-3 text-body-sm font-bold text-ink-subtle hover:text-ink transition-colors group px-1 w-full"
              >
                <div className={`h-8 w-8 rounded-md flex items-center justify-center transition-[background-color,color] ${showCompleted ? "bg-ink text-paper" : "bg-gray-100 text-ink-subtle group-hover:bg-gray-200 group-hover:text-ink"}`}>
                  <motion.div
                    animate={{ rotate: showCompleted ? 90 : 0 }}
                    transition={{ type: "spring", stiffness: 280, damping: 22, mass: 0.8 }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </motion.div>
                </div>
                <span className="uppercase tracking-widest">Completed Tasks</span>
                <div className="h-px flex-1 bg-gradient-to-r from-gray-100 to-transparent" />
              </button>
              <AnimatePresence initial={false}>
                {showCompleted && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-4">
                      {completedLoading && completedPreview.length === 0 ? (
                        <MasonryColumns
                          items={[...Array(Math.min(3, COMPLETED_PREVIEW_SIZE))].map((_, i) => ({ id: `completed-skeleton-${i}` }))}
                          getKey={(item) => item.id}
                          renderItem={() => <TodoSkeleton />}
                          columns={4}
                          breakpoints={TODO_MASONRY_BREAKPOINTS}
                        />
                      ) : (
                        <>
                          <MasonryColumns
                            items={sortedCompletedPreview}
                            getKey={(todo) => todo.id}
                            getItemWeight={getTaskWeight}
                            columns={4}
                            breakpoints={TODO_MASONRY_BREAKPOINTS}
                            renderItem={(todo) => (
                              <TodoCard
                                todo={todo}
                                variant="completed"
                                onComplete={() => handleComplete(todo.id)}
                                onDelete={() => requestDelete(todo)}
                                onEdit={() => setEditingTodo(todo)}
                                onToggleHidden={() => handleToggleHidden(todo.id)}
                              />
                            )}
                          />
                          <div className="rounded-[1.75rem] border border-line bg-paper/90 p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                              <p className="text-caption font-bold uppercase tracking-[0.2em] text-ink-subtle">
                                {completedTotalCount > COMPLETED_PREVIEW_SIZE
                                  ? `Showing latest ${COMPLETED_PREVIEW_SIZE}`
                                  : "Completed archive preview"}
                              </p>
                              <p className="text-body-sm text-ink-subtle font-medium">
                                {completedTotalCount > COMPLETED_PREVIEW_SIZE
                                  ? `Open the archive to browse all ${completedTotalCount} completed tasks.`
                                  : "All completed tasks currently fit in this section."}
                              </p>
                            </div>
                            <Button asChild size="sm" className="rounded-lg font-bold shadow-lg shadow-black/10">
                              <Link href="/tasks/completed">
                                <History className="h-4 w-4" />
                                View all completed tasks
                              </Link>
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {editingTodo && (
          <EditTodoModal
            todo={editingTodo}
            categories={categories}
            onClose={() => setEditingTodo(null)}
            onSave={(payload) => handleUpdate(editingTodo.id, payload)}
            onSaveViewerPreference={(payload) => handleSaveViewerPreference(editingTodo.id, payload.viewerCategoryId)}
            onCreateCategory={fetchCategories}
            commentsRefreshKey={commentsRefreshKey}
            onStartWork={async () => {
              const todo = editingTodo
              if (!todo) return
              if (isTodoOwner(todo, user?.userId)) {
                try {
                  await api.put(`/todos/api/v1/todos/${todo.id}`, { status: "inProgress" })
                  setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, status: "In Progress" } : t))
                  setEditingTodo((prev) => prev ? { ...prev, status: "In Progress" } : prev)
                  setCommentsRefreshKey((k) => k + 1)
                } catch {
                  addToast({ type: "error", title: "Could not update task" })
                }
              } else {
                try {
                  const updated = await joinTodo(todo.id)
                  setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, ...updated } : t))
                  setEditingTodo((prev) => prev ? { ...prev, ...updated } : prev)
                  setCommentsRefreshKey((k) => k + 1)
                } catch (err: unknown) {
                  const status = (err as { response?: { status: number } })?.response?.status
                  addToast(status === 409
                    ? { type: "warning", title: "Task is full or you have already joined" }
                    : { type: "error", title: "Could not join task" })
                }
              }
            }}
            onCompleteTask={() => handleComplete(editingTodo.id)}
            onDuplicate={() => handleDuplicate(editingTodo.id)}
            onDescriptionChange={(desc) => {
              const update = (prev: Todo[]) => prev.map(t => t.id === editingTodo.id ? { ...t, description: desc } : t)
              setTodos(update)
              setCompletedPreview(update)
              setEditingTodo(prev => prev ? { ...prev, description: desc } : null)
            }}
            onLeave={async () => {
              const todo = editingTodo
              if (!todo) return
              if (isTodoOwner(todo, user?.userId)) {
                try {
                  await api.put(`/todos/api/v1/todos/${todo.id}`, { status: "todo" })
                  setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, status: "Todo" } : t))
                  setCommentsRefreshKey((k) => k + 1)
                } catch {
                  addToast({ type: "error", title: "Could not stop working" })
                }
              } else {
                try {
                  await leaveTodo(todo.id)
                  setTodos((prev) => prev.map((t) =>
                    t.id === todo.id ? { ...t, isWorking: false, workerCount: Math.max(0, (t.workerCount ?? 1) - 1) } : t
                  ))
                  setCommentsRefreshKey((k) => k + 1)
                } catch {
                  addToast({ type: "error", title: "Could not leave task" })
                }
              }
            }}
          />
        )}
      </AnimatePresence>

      {/*
        Capture, before anything else. It is `position: fixed` in the phone's thumb
        zone, and it is hidden whenever a dialog owns the screen — otherwise it
        floats over the backdrop and is reachable by Tab from behind it.
      */}
      <QuickCapture onCapture={handleQuickCapture} hidden={!listKeysEnabled} />

      <SelectionBar
        count={nav.selectedIds.length}
        onClear={nav.clearSelection}
        actions={[
          {
            id: "complete",
            label: "Complete",
            icon: CheckCircle2,
            onRun: () => {
              const ids = nav.selectedIds
              nav.clearSelection()
              // Sequentially, not Promise.all: the completion path refetches and
              // rewrites the list, and ten of those racing produces ten different
              // answers about what the list contains.
              void ids.reduce<Promise<unknown>>(
                (chain, id) => chain.then(() => handleComplete(id)),
                Promise.resolve(),
              )
            },
          },
          {
            id: "delete",
            label: "Delete",
            icon: Trash2,
            destructive: true,
            onRun: () => {
              const ids = nav.selectedIds
              nav.clearSelection()
              // One undo entry per task would stack five seconds of bars nobody can
              // read, so the selection is deleted as one action with one window —
              // `useUndoableAction` commits the previous pending action when a new
              // one starts, which is exactly the behaviour a batch needs.
              requestDeleteMany(ids)
            },
          },
        ]}
      />

      <UndoBar pending={undoable.pending} onUndo={undoable.undo} />

      <CategoryFilterModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        categories={categories}
        selected={filterCategoryIds}
        onChange={handleFilterChange}
      />
    </div>
  )
}
