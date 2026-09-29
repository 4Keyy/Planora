"use client"

import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { useCollapseScroll } from "@/hooks/use-collapse-scroll"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { Plus, CheckCircle2, AlertTriangle, CalendarClock, Users, ArrowRight } from "lucide-react"
import axios from "axios"
import { api, parseApiResponse, setTaskHidden, fetchTaskById, setViewerPreference, joinTodo, leaveTodo, duplicateTodo, type ApiResponse } from "@/lib/api"
import { ensureFriendNames } from "@/lib/friend-names"
import { isAuthorAlreadyCompletedError, AUTHOR_COMPLETED_TOAST } from "@/lib/errors"
import { truncateText } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Todo, isTodoOwner, sameUserId, toApiTodoStatus, type CreateTodoPayload, type UpdateTodoPayload } from "@/types/todo"
import { useFeedSync } from "@/lib/realtime/hooks"
import { TodoCard } from "@/components/todos/todo-card"
import { useToastStore } from "@/store/toast"
import { Category } from "@/types/category"
import dynamic from "next/dynamic"
// Lazy-load the editing surface: it only mounts when a user clicks edit or
// opens the create panel. Cuts dashboard First Load JS without touching UX —
// the framer-motion enter animation absorbs the chunk fetch on first open.
const EditTodoModal = dynamic(
  () => import("@/components/todos/edit-todo-modal").then((m) => ({ default: m.EditTodoModal })),
  { ssr: false },
)
const CreateTodoPanel = dynamic(
  () => import("@/components/todos/create-todo-panel").then((m) => ({ default: m.CreateTodoPanel })),
  // The collapsed panel is always on screen, so its place is held while the chunk loads —
  // without this the task grid below it dropped 105px when the panel arrived.
  { ssr: false, loading: () => <CreatePlatePlaceholder /> },
)
import { MasonryColumns } from "@/components/ui/masonry-columns"
import { TASK_GRID_BREAKPOINTS, TASK_GRID_COLUMNS } from "@/lib/task-grid"
import { CreatePlatePlaceholder } from "@/components/todos/plate-placeholder"
import { sortTasks, getTaskWeight } from "@/utils/sort-tasks"
import { applyCategoryPatch } from "@/utils/todo-utils"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { StatusPanel } from "@/components/ui/status-panel"
import { Pagination } from "@/components/ui/pagination"
import { FIELD_LABEL_CLASS } from "@/components/ui/field-label"
import { NumberRoll } from "@/components/ui/number-roll"
import { WeekBars } from "@/components/ui/week-bars"
import { StatRow } from "@/components/ui/stat-row"
import { DURATION_DELIBERATE, EASE_OUT_EXPO } from "@/lib/animations"
import { QuickCapture } from "@/components/todos/quick-capture"
import { UndoBar, useUndoableAction } from "@/components/ui/undo-bar"

const STATS_COMPLETED_PREVIEW_SIZE = 100
const STATS_REQUEST_TIMEOUT_MS = 30000
const FIRST_RUN_STORAGE_KEY = "planora-first-run"
type CategoryResponse = Category[] | { items?: Category[]; value?: Category[] | { items?: Category[] } }

const normalizeCategoryResponse = (response: CategoryResponse): Category[] => {
  const data = Array.isArray(response) ? response : response.value ?? response
  return Array.isArray(data) ? data : data.items ?? []
}

function ProgressCircle({ value, total }: { value: number; total: number }) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0
  const reduce = useReducedMotion() ?? false
  return (
    <div className="relative h-24 w-24 flex-shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
        {/* The track — the whole of the week, unfilled. */}
        <circle cx="18" cy="18" r="15.9155" className="stroke-line" strokeWidth="3" fill="none" />
        {/*
         * The ring is DRAWN, not revealed: `pathLength` is framer-motion's one
         * sanctioned non-transform animation, and it lets the arc be expressed as the
         * fraction it is (0-1). Drawing over `deliberate` (480ms) puts it on the same
         * beat as the numeral rolling beside it: the two are one statement about the
         * week. `MotionConfig` does not reach `pathLength`, hence the explicit branch.
         */}
        <motion.circle
          cx="18"
          cy="18"
          r="15.9155"
          className="stroke-ink"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: percentage / 100 }}
          transition={{ duration: reduce ? 0 : DURATION_DELIBERATE, ease: EASE_OUT_EXPO }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-title-sm font-bold tabular-nums text-ink">
        <NumberRoll value={percentage} />
        <span className="text-body-sm font-semibold">%</span>
      </span>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const addToast = useToastStore(s => s.addToast)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const hasHydrated = useAuthStore(s => s.hasHydrated)
  const user = useAuthStore(s => s.user)

  const [todos, setTodos] = useState<Todo[]>([])
  const [statsTodos, setStatsTodos] = useState<Todo[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageSize] = useState(6)
  const [currentPage, setCurrentPage] = useState(1)
  const [lastFetchedPage, setLastFetchedPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  /** Deletions wait five seconds in here instead of behind a confirmation dialog. */
  const undoable = useUndoableAction()
  const [mounted, setMounted] = useState(false)
  const [firstRun, setFirstRun] = useState(false)
  const firstRunAutoOpenedRef = useRef(false)
  const friendNameCache = useRef<Map<string, string>>(new Map())
  const currentPageRef = useRef(currentPage)

  // PERF: TodoCard is memoized and ignores callback identity, so the handlers it
  // holds may be from an earlier render. We mirror the live lists into refs and
  // read them inside the handlers, guaranteeing those (possibly stale) closures
  // always operate on the current data while staying referentially stable.
  const todosRef = useRef(todos)
  const statsTodosRef = useRef(statsTodos)
  todosRef.current = todos
  statsTodosRef.current = statsTodos

  // Smooth scroll to top when create panel collapses
  useCollapseScroll(isCreateOpen)

  const fetchCategories = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await api.get<CategoryResponse>("/categories/api/v1/categories", { signal })
      if (signal?.aborted) return
      setCategories(normalizeCategoryResponse(res.data))
    } catch (err) {
      if (axios.isCancel(err) || signal?.aborted) return
    }
  }, [])

  const enrichTodosWithAuthorNames = useCallback(async (items: Todo[]) => {
    const currentUserId = user?.userId
    if (!currentUserId) return items

    const friendIds = new Set(
      items
        .filter((t) => {
          if (!t.userId || t.userId === currentUserId) return false
          const isFriendVisible = t.isPublic || (t.sharedWithUserIds?.length ?? 0) > 0
          return isFriendVisible
        })
        .map((t) => t.userId)
    )

    if (friendIds.size === 0) return items

    await ensureFriendNames(friendIds, friendNameCache.current)

    if (friendNameCache.current.size === 0) return items

    return items.map((t) => {
      if (!t.userId || t.userId === currentUserId) return t
      const isFriendVisible = t.isPublic || (t.sharedWithUserIds?.length ?? 0) > 0
      if (!isFriendVisible) return t
      const authorName = friendNameCache.current.get(t.userId)
      return authorName ? { ...t, authorName } : t
    })
  }, [user?.userId])

  const fetchStats = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await api.get<{ items: Todo[] }>("/todos/api/v1/todos", {
        // Only completed items are needed for the weekly stats. Active task count
        // comes from fetchTodos(totalCount), keeping this request small even when
        // a user has a large backlog. Completed subtasks still count toward the
        // weekly total, so this stats-only fetch opts into them.
        params: {
          pageNumber: 1,
          pageSize: STATS_COMPLETED_PREVIEW_SIZE,
          isCompleted: true,
          includeSubtasks: true,
        },
        signal,
        timeout: STATS_REQUEST_TIMEOUT_MS,
      })
      if (signal?.aborted) return
      const items = res.data.items ?? []
      const enriched = await enrichTodosWithAuthorNames(items)
      if (signal?.aborted) return
      setStatsTodos(enriched)
    } catch (err) {
      if (axios.isCancel(err) || signal?.aborted) return
      console.error("Failed to fetch stats:", err)
    }
  }, [enrichTodosWithAuthorNames])

  // Keep ref in sync so fetchTodos can default to the current page without
  // capturing it in its dep array (which would cause the event listener to
  // be torn down and re-added on every pagination click).
  useEffect(() => { currentPageRef.current = currentPage }, [currentPage])

  const fetchTodos = useCallback(async (page = currentPageRef.current, { signal, silent = false }: { signal?: AbortSignal; silent?: boolean } = {}) => {
    try {
      // Mutation-triggered refreshes pass silent:true so the page reconciles in the
      // background without flashing the skeleton grid over cards already on screen.
      if (!silent) setLoading(true)
      const res = await api.get<{ items: Todo[]; totalCount: number }>("/todos/api/v1/todos", {
        params: {
          pageNumber: page,
          pageSize,
          status: "Todo,InProgress",
          isCompleted: false, // Explicitly request active tasks (backend now handles per-viewer completion)
        },
        signal,
      })
      if (signal?.aborted) return
      const items = res.data.items ?? []
      const enriched = await enrichTodosWithAuthorNames(items)
      if (signal?.aborted) return
      setTodos(enriched)
      setTotalCount(res.data.totalCount ?? 0)
      setLastFetchedPage(page)
    } catch (err) {
      if (axios.isCancel(err) || signal?.aborted) return
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load todos")
    } finally {
      if (!silent && !signal?.aborted) setLoading(false)
    }
  }, [pageSize, enrichTodosWithAuthorNames])

  // Set mounted flag on client side to prevent hydration mismatches
  useEffect(() => {
    setMounted(true)
    try {
      setFirstRun(sessionStorage.getItem(FIRST_RUN_STORAGE_KEY) === "1")
    } catch {
      setFirstRun(false)
    }
  }, [])

  useEffect(() => {
    if (!firstRun || firstRunAutoOpenedRef.current || loading || totalCount !== 0 || isCreateOpen) return
    firstRunAutoOpenedRef.current = true
    setIsCreateOpen(true)
  }, [firstRun, loading, totalCount, isCreateOpen])

  // ── Live cross-user sync ──────────────────────────────────────────────────
  // A friend changed a task we can see. The dashboard is paginated + drives weekly stats, so the
  // cleanest reconcile is a silent refetch of the current page and the stats set. A short debounce
  // coalesces bursts (e.g. a friend completing several tasks) into one refresh. Own echoes are
  // skipped — the local optimistic update already reflected them.
  const liveSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useFeedSync(useCallback((signal) => {
    if (sameUserId(signal.actorId, user?.userId)) return
    if (liveSyncTimerRef.current) clearTimeout(liveSyncTimerRef.current)
    liveSyncTimerRef.current = setTimeout(() => {
      void Promise.all([fetchTodos(undefined, { silent: true }), fetchStats()])
    }, 400)
  }, [fetchTodos, fetchStats, user?.userId]))
  // Cancel any pending debounced refresh on unmount so it never setStates an unmounted page.
  useEffect(() => () => {
    if (liveSyncTimerRef.current) clearTimeout(liveSyncTimerRef.current)
  }, [])


  useEffect(() => {
    // Only run once store is hydrated AND component is mounted
    if (!hasHydrated || !mounted) return

    // Check if user is authenticated and has valid token
    if (!isAuthenticated) {
      router.replace("/auth/login")
      return
    }

    const tokenValid = useAuthStore.getState().isTokenValid()
    if (!tokenValid) {
      clearAuth()
      router.replace("/auth/login")
      return
    }

    // Cancel all three mount-time fetches on unmount or auth change so a
    // rapid route switch does not race setState on an unmounted component.
    const controller = new AbortController()
    void Promise.all([
      fetchTodos(currentPageRef.current, { signal: controller.signal }),
      fetchStats(controller.signal),
      fetchCategories(controller.signal),
    ])
    return () => controller.abort()
  }, [isAuthenticated, hasHydrated, mounted, fetchTodos, fetchStats, fetchCategories, clearAuth, router])

  const activeStatsCount = totalCount

  // Completed-this-week deliberately includes completed subtasks so finishing a step in a
  // task's branch contributes to the weekly statistics.
  const allCompletedStatsTodos = useMemo(() =>
    statsTodos.filter(t => {
      const s = String(t.status).toLowerCase();
      const isDone = s === "done" || s === "completed";
      return isDone || t.isCompletedByViewer === true;
    }),
    [statsTodos]
  )

  const recentCompletedStatsTodos = useMemo(() => {
    const oneWeekAgo = new Date()
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)

    return allCompletedStatsTodos.filter(t => {
      const completedDate = t.completedAt ? new Date(t.completedAt) : (t.updatedAt ? new Date(t.updatedAt) : null)
      return completedDate ? completedDate >= oneWeekAgo : false
    })
  }, [allCompletedStatsTodos])

  const totalForStats = activeStatsCount + recentCompletedStatsTodos.length

  // Filter out tasks that are completed by the viewer (for shared/public tasks)
  const activeTodos = useMemo(() => {
    const filtered = todos.filter(t => t.isCompletedByViewer !== true)
    return sortTasks(filtered)
  }, [todos])

  /**
   * The three questions a person actually arrives at a dashboard with: what is
   * late, what is today, and what are other people waiting on me for. A total —
   * which is all this hero used to say — answers none of them.
   *
   * Computed from the active list already in memory: no extra request, and the
   * numbers cannot disagree with the cards underneath them.
   */
  const heroStats = useMemo(() => {
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    let overdue = 0
    let dueToday = 0
    let shared = 0

    for (const t of activeTodos) {
      if (t.dueDate) {
        const due = new Date(t.dueDate)
        if (!Number.isNaN(due.getTime())) {
          if (due < startOfToday) overdue++
          else if (due <= endOfToday) dueToday++
        }
      }
      if (t.isPublic || (t.sharedWithUserIds?.length ?? 0) > 0) shared++
    }
    return { overdue, dueToday, shared }
  }, [activeTodos])

  useEffect(() => {
    if (loading) return

    if (totalCount === 0) {
      if (currentPage !== 1) setCurrentPage(1)
      return
    }

    const pages = Math.ceil(totalCount / pageSize)
    if (currentPage > pages) {
      setCurrentPage(pages)
      return
    }

    if (activeTodos.length === 0 && currentPage > 1 && lastFetchedPage === currentPage) {
      setCurrentPage(currentPage - 1)
    }
  }, [loading, totalCount, currentPage, pageSize, activeTodos.length, lastFetchedPage])

  const handleCreate = async (payload: CreateTodoPayload) => {
    const res = await api.post<ApiResponse<Todo>>("/todos/api/v1/todos", payload)
    setIsCreateOpen(false)
    setFirstRun(false)
    try {
      sessionStorage.removeItem(FIRST_RUN_STORAGE_KEY)
    } catch { }
    addToast({ type: "success", title: "Task created!" })
    setCurrentPage(1)
    // Surface the new task immediately, then reconcile silently in the background.
    const created = parseApiResponse<Todo>(res.data)
    if (created?.id) {
      const [enriched] = await enrichTodosWithAuthorNames([created])
      setTodos((prev) => prev.some((t) => t.id === created.id) ? prev : [enriched, ...prev])
      setStatsTodos((prev) => prev.some((t) => t.id === created.id) ? prev : [enriched, ...prev])
      setTotalCount((c) => c + 1)
    }
    // Reconcile in the background — don't block on the slow refetch. The create panel's resetForm
    // runs only after onSubmit resolves, so awaiting here left the fields filled for seconds.
    void Promise.all([fetchTodos(1, { silent: true }), fetchStats()])
  }

  /**
   * Capture: a title, and the promise left to reject.
   *
   * Not `handleCreate` with a synthesised payload — that one closes the create
   * panel, clears the first-run state and raises a success toast, none of which
   * apply here. The toast in particular would be noise: the field collapsing back
   * into the button already said it worked, and a message that repeats what the
   * screen just showed is a message people learn to ignore.
   */
  const handleQuickCapture = useCallback(async (title: string) => {
    const res = await api.post<ApiResponse<Todo>>("/todos/api/v1/todos", { title })
    const created = parseApiResponse<Todo>(res.data)
    if (created?.id) {
      const [enriched] = await enrichTodosWithAuthorNames([created])
      const prepend = (prev: Todo[]) => (prev.some((t) => t.id === created.id) ? prev : [enriched, ...prev])
      setTodos(prepend)
      setStatsTodos(prepend)
      setTotalCount((c) => c + 1)
    }
    void Promise.all([fetchTodos(1, { silent: true }), fetchStats()])
  }, [enrichTodosWithAuthorNames, fetchTodos, fetchStats])

  /**
   * Delete with a window, not a dialog — the same affordance `/tasks` has.
   *
   * Two screens that delete the same object two different ways is not a nuance a
   * user models; it is a product that contradicts itself. The dialog here also
   * claimed "This action cannot be undone", which was true of the request and
   * false of the intent — the whole point of the window is that the request has
   * not been sent yet.
   *
   * The card leaves both lists at once and remembers where it was in each, so undo
   * puts it back in place rather than on top. The request is sent only when the
   * five-second window closes; undo cancels the timer and nothing reaches the
   * server. See components/ui/undo-bar.tsx for why that is the honest shape: the
   * API has no restore endpoint.
   */
  const requestDelete = useCallback((todo: Todo) => {
    const listIndex = todosRef.current.findIndex((t) => t.id === todo.id)
    const statsIndex = statsTodosRef.current.findIndex((t) => t.id === todo.id)
    const wasCompleted = ["done", "completed"].includes(String(todo.status).toLowerCase())

    const restoreInto = (index: number) => (prev: Todo[]) => {
      if (prev.some((t) => t.id === todo.id)) return prev
      const next = [...prev]
      next.splice(index < 0 || index > next.length ? next.length : index, 0, todo)
      return next
    }

    setTodos((prev) => prev.filter((t) => t.id !== todo.id))
    setStatsTodos((prev) => prev.filter((t) => t.id !== todo.id))
    if (!wasCompleted) setTotalCount((c) => Math.max(0, c - 1))

    const restore = () => {
      setTodos(restoreInto(listIndex))
      setStatsTodos(restoreInto(statsIndex))
      if (!wasCompleted) setTotalCount((c) => c + 1)
    }

    undoable.run({
      label: `“${truncateText(todo.title, 40)}” deleted`,
      commit: async () => {
        try {
          await api.delete(`/todos/api/v1/todos/${todo.id}`)
        } catch {
          addToast({ type: "error", title: "Failed to delete task" })
          // The server refused, so put it back rather than leave the user
          // believing a task is gone when it is not.
          restore()
        }
      },
      rollback: restore,
    })
  }, [undoable, addToast])

  const handleComplete = useCallback(async (todoId: string) => {
    const existing = todosRef.current.find(t => t.id === todoId) || statsTodosRef.current.find(t => t.id === todoId)
    if (!existing) return

    const isOwner = isTodoOwner(existing, user?.userId)
    const isShared = existing.isPublic || (existing.sharedWithUserIds?.length ?? 0) > 0

    // Non-owner viewing a shared task: toggle per-viewer completion only
    if (!isOwner && isShared) {
      const wasCompleted = existing.isCompletedByViewer === true
      // Once the author closes the whole task globally it is done for EVERYONE: a non-owner can
      // neither reopen nor re-complete it, so block any toggle up-front (regardless of their own
      // per-viewer state) and tell them to duplicate instead — no premature "Task completed!" toast.
      if (existing.ownerCompleted === true) {
        addToast(AUTHOR_COMPLETED_TOAST)
        return
      }
      try {
        const result = await setViewerPreference(todoId, { completedByViewer: !wasCompleted })
        if (!wasCompleted) {
          setTodos(prev => prev.filter(t => t.id !== todoId))
          setTotalCount(prev => Math.max(0, prev - 1))
        } else {
          void fetchTodos(undefined, { silent: true })
        }
        setStatsTodos(prev => prev.map(t =>
          t.id !== todoId ? t : { ...t, isCompletedByViewer: result.completedByViewer ?? false, ownerCompleted: result.ownerCompleted }
        ))
        addToast({ type: "success", title: wasCompleted ? "Task reopened!" : "Task completed!" })
      } catch (e) {
        if (isAuthorAlreadyCompletedError(e)) {
          addToast(AUTHOR_COMPLETED_TOAST)
        } else {
          addToast({ type: "error", title: "Failed to update task" })
        }
      }
      return
    }

    const status = String(existing.status).toLowerCase()
    const isCompleted = status === "done" || status === "completed"
    const newStatus = isCompleted ? "todo" : "done"

    try {
      const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${todoId}`, { status: newStatus })
      const updated = parseApiResponse(res.data)

      if (!isCompleted) {
        setTodos(prev => prev.filter(t => t.id !== todoId))
        setTotalCount(prev => Math.max(0, prev - 1))
      } else {
        void fetchTodos(undefined, { silent: true })
      }

      setStatsTodos(prev => prev.map(t => {
        if (t.id !== todoId) return t
        const authorName = t.authorName ?? friendNameCache.current.get(updated.userId)
        return { ...updated, authorName }
      }))
      addToast({
        type: "success",
        title: isCompleted ? "Task reopened!" : "Task completed!",
      })
    } catch {
      addToast({ type: "error", title: "Failed to update task" })
    }
  }, [user?.userId, addToast, fetchTodos])


  const handleUpdate = async (todoId: string, payload: UpdateTodoPayload) => {
    const existing = todos.find(t => t.id === todoId) || statsTodos.find(t => t.id === todoId)
    if (!existing) return

    try {
      const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${todoId}`, {
        ...payload,
        status: toApiTodoStatus(existing.status),
      })
      const updated = parseApiResponse(res.data)
      const merged = applyCategoryPatch({ ...updated }, payload.categoryId)
      const applyMerge = (t: Todo) =>
        t.id !== todoId ? t : { ...merged, authorName: t.authorName ?? friendNameCache.current.get(updated.userId) }
      setTodos(prev => prev.map(applyMerge))
      setStatsTodos(prev => prev.map(applyMerge))
      // Autosave path: keep the modal open and quiet (the in-modal indicator confirms it);
      // do not refresh `editingTodo` so the open modal's local field state is never clobbered.
    } catch (error) {
      addToast({ type: "error", title: "Failed to save changes" })
      throw error // surface the error state in the modal's autosave indicator
    }
  }

  const handleSaveViewerPreference = useCallback(async (todoId: string, viewerCategoryId: string | null) => {
    const existing = todos.find(t => t.id === todoId) || statsTodos.find(t => t.id === todoId)
    if (!existing) return

    try {
      await setViewerPreference(todoId, {
        viewerCategoryId,
        updateViewerCategory: true,
      })

      const fullTask = await fetchTaskById(todoId)
      const authorName = existing.authorName ?? friendNameCache.current.get(fullTask.userId)
      const enriched = authorName ? { ...fullTask, authorName } : fullTask

      setTodos(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
      setStatsTodos(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
      // Autosave path: stay open and quiet; the modal's AutosaveIndicator confirms the save.
    } catch (error) {
      addToast({ type: "error", title: "Failed to save your category" })
      throw error // surface the error state in the modal's autosave indicator
    }
  }, [todos, statsTodos, addToast])

  const handleJoin = useCallback(async (todoId: string) => {
    const existing = todosRef.current.find(t => t.id === todoId) ?? statsTodosRef.current.find(t => t.id === todoId)
    if (!existing) return
    const isOwnerTask = !!user?.userId && existing.userId === user.userId
    try {
      if (isOwnerTask) {
        await api.put(`/todos/api/v1/todos/${todoId}`, { status: "inProgress" })
        const upd = (t: Todo) => t.id !== todoId ? t : { ...t, status: "In Progress" }
        setTodos(prev => prev.map(upd))
        setStatsTodos(prev => prev.map(upd))
      } else {
        const updated = await joinTodo(todoId)
        const authorName = existing.authorName ?? friendNameCache.current.get(updated.userId)
        const enriched = authorName ? { ...updated, authorName } : updated
        setTodos(prev => prev.map(t => t.id !== todoId ? t : enriched))
        setStatsTodos(prev => prev.map(t => t.id !== todoId ? t : enriched))
      }
      addToast({ type: "success", title: "Task taken!" })
    } catch {
      addToast({ type: "error", title: "Could not take task" })
    }
  }, [user?.userId, addToast])

  const handleLeave = useCallback(async (todoId: string) => {
    const existing = todos.find(t => t.id === todoId) ?? statsTodos.find(t => t.id === todoId)
    if (!existing) return
    const isOwnerTask = !!user?.userId && existing.userId === user.userId
    try {
      if (isOwnerTask) {
        await api.put(`/todos/api/v1/todos/${todoId}`, { status: "todo" })
        const upd = (t: Todo) => t.id !== todoId ? t : { ...t, status: "Todo" }
        setTodos(prev => prev.map(upd))
        setStatsTodos(prev => prev.map(upd))
      } else {
        await leaveTodo(todoId)
        const upd = (t: Todo) => t.id !== todoId ? t : { ...t, isWorking: false, workerCount: Math.max(0, (t.workerCount ?? 1) - 1) }
        setTodos(prev => prev.map(upd))
        setStatsTodos(prev => prev.map(upd))
      }
      // Reflect the change in the open branch modal (if any) WITHOUT closing it — leaving work
      // keeps the modal open so the "left the task" event is read in place (BranchFeed polls it in).
      setEditingTodo(prev => prev && prev.id === todoId
        ? { ...prev, status: isOwnerTask ? "Todo" : prev.status, isWorking: isOwnerTask ? prev.isWorking : false }
        : prev)
      addToast({ type: "success", title: "Left task" })
    } catch {
      addToast({ type: "error", title: "Could not leave task" })
    }
  }, [todos, statsTodos, user?.userId, addToast])

  const handleDuplicate = useCallback(async (todoId: string) => {
    try {
      await duplicateTodo(todoId)
      void fetchTodos(undefined, { silent: true })
      addToast({ type: "success", title: "Task duplicated", description: "A fresh copy was added to your active tasks." })
    } catch {
      addToast({ type: "error", title: "Could not duplicate task" })
      throw new Error("duplicate failed")
    }
  }, [fetchTodos, addToast])

  const handleToggleHidden = useCallback(async (todoId: string) => {
    const existing = todosRef.current.find(t => t.id === todoId) ?? statsTodosRef.current.find(t => t.id === todoId)
    if (!existing) return
    const newHidden = !(existing.hidden ?? false)
    const isOwner = !!user?.userId && existing.userId === user.userId
    const canOptimisticallyToggle = isOwner || newHidden

    const optimisticUpdate = (prev: Todo[]) =>
      prev.map(t => t.id === todoId ? { ...t, hidden: newHidden } : t)
    if (canOptimisticallyToggle) {
      setTodos(optimisticUpdate)
      setStatsTodos(optimisticUpdate)
    }

    try {
      if (isOwner) {
        const response = await setTaskHidden(todoId, newHidden)

        const mergeHidden = (prev: Todo[]) =>
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
        setTodos(mergeHidden)
        setStatsTodos(mergeHidden)

        if (!newHidden) {
          const fullTask = await fetchTaskById(todoId)
          const authorName = friendNameCache.current.get(fullTask.userId)
          const enriched = authorName ? { ...fullTask, authorName, hidden: false } : { ...fullTask, hidden: false }
          setTodos(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
          setStatsTodos(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
        }
      } else {
        await setViewerPreference(todoId, { hiddenByViewer: newHidden })

        if (!newHidden) {
          const fullTask = await fetchTaskById(todoId)
          const authorName = friendNameCache.current.get(fullTask.userId)
          const enriched = authorName ? { ...fullTask, authorName, hidden: false } : { ...fullTask, hidden: false }
          setTodos(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
          setStatsTodos(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
        }
      }
    } catch {
      if (canOptimisticallyToggle) {
        const revert = (prev: Todo[]) =>
          prev.map(t => t.id === todoId ? { ...t, hidden: !newHidden } : t)
        setTodos(revert)
        setStatsTodos(revert)
      }
      addToast({ type: "error", title: "Failed to update task visibility" })
    }
  }, [addToast, user?.userId])

  const handleDeleteCategory = async (categoryId: string) => {
    try {
      await api.delete(`/categories/api/v1/categories/${categoryId}`)
      await fetchCategories()
      await Promise.all([fetchTodos(), fetchStats()])
    } catch { }
  }

  const handlePageChange = useCallback((page: number) => {
    const maxPage = Math.max(1, Math.ceil(totalCount / pageSize))
    const nextPage = Math.max(1, Math.min(maxPage, page))
    if (nextPage === currentPage) return
    setCurrentPage(nextPage)
    void fetchTodos(nextPage)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }, [currentPage, totalCount, pageSize, fetchTodos])

  const totalPages = Math.ceil(totalCount / pageSize)
  const totalCountForStats = totalForStats
  const completedCountForStats = recentCompletedStatsTodos.length

  return (
    <div className="space-y-10">
      {/*
        The week, stated once. It used to be a gradient card with two blurred orbs behind
        it, a "WORKSPACE OVERVIEW" pill, a hover shadow on the whole card and a second
        glass card nested inside it for the ring; each piece arrived on its own delay.
        Now it is one paper card, and the only things that move are the numbers.
      */}
      <section
        aria-label="Overview"
        className="rounded-xl border border-line bg-paper p-6 shadow-sm sm:p-8"
      >
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className={FIELD_LABEL_CLASS}>Overview</p>
            <h1 className="mt-2 text-title font-bold tracking-tight text-ink sm:text-display-sm">
              You have{" "}
              {/* The headline number rolls rather than re-mounting: "one fewer task", not
                  "this component rendered". */}
              <span className="tabular-nums">
                <NumberRoll value={activeStatsCount} announce />
              </span>{" "}
              {activeStatsCount === 1 ? "open task." : "open tasks."}
            </h1>
            {/* Each of these is a filter, not a label: the number is half an answer and
                pressing it should show the tasks it counted. */}
            <StatRow
              className="mt-6"
              stats={[
                { id: "overdue", label: "overdue", value: heroStats.overdue, icon: AlertTriangle, tone: "alert", onSelect: () => router.push("/tasks") },
                { id: "today", label: "due today", value: heroStats.dueToday, icon: CalendarClock, onSelect: () => router.push("/tasks") },
                { id: "shared", label: "shared", value: heroStats.shared, icon: Users, onSelect: () => router.push("/tasks") },
              ]}
            />
          </div>

          <div className="flex items-center gap-6 border-t border-line pt-6 lg:w-96 lg:flex-shrink-0 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <ProgressCircle value={completedCountForStats} total={totalCountForStats} />
            <div className="min-w-0 flex-1">
              <p className={FIELD_LABEL_CLASS}>This week</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="text-title font-bold tabular-nums text-ink">
                  <NumberRoll value={completedCountForStats} />
                </span>
                <span className="text-body-sm font-medium text-ink-muted">completed</span>
              </p>
              {/* The shape of the week, not just its total. Built from the completion
                  timestamps already loaded for the ring, so it costs no request and
                  cannot disagree with the number above it. */}
              <WeekBars
                className="mt-3"
                completions={recentCompletedStatsTodos.map((t) => t.completedAt ?? t.updatedAt)}
              />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="active-tasks-heading" className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h2 id="active-tasks-heading" className="flex items-center gap-3 text-title-sm font-bold tracking-tight text-ink">
            Active tasks
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-paper-sunken px-2 text-caption font-semibold tabular-nums text-ink-muted ring-1 ring-inset ring-line">
              {totalCount}
            </span>
          </h2>
          <Button size="sm" variant="ghost" onClick={() => router.push("/tasks")} className="-mr-3">
            All tasks
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {/* The create panel spans the column. It sat alone in a sidebar a third of the
            page wide, which squeezed the task cards into three narrow columns beside a
            mostly empty one. */}
        <CreateTodoPanel
          isOpen={isCreateOpen}
          onToggle={() => setIsCreateOpen(!isCreateOpen)}
          categories={categories}
          onSubmit={handleCreate}
          onCreateCategory={fetchCategories}
          onDeleteCategory={handleDeleteCategory}
        />

        {loading && (
          <MasonryColumns
            items={[...Array(pageSize)].map((_, i) => ({ id: `skeleton-${i}` }))}
            getKey={(item) => item.id}
            renderItem={() => <TodoSkeleton />}
            columns={TASK_GRID_COLUMNS}
            breakpoints={TASK_GRID_BREAKPOINTS}
          />
        )}

        {error && !loading && (
          <StatusPanel
            tone="alert"
            icon={AlertTriangle}
            title="Couldn't load your tasks"
            description={error}
            action={{ label: "Try again", onClick: () => void fetchTodos() }}
          />
        )}

        {!loading && !error && (
          <>
            {activeTodos.length === 0 ? (
              firstRun ? (
                <div className="rounded-xl border border-dashed border-line bg-paper px-6 py-12 text-center sm:px-12">
                  <h3 className="text-title font-bold tracking-tight text-ink">Welcome to Planora</h3>
                  <p className="mx-auto mt-2 max-w-md text-body text-ink-muted">
                    Start with one task, then invite the person you want to coordinate with.
                  </p>
                  <ol className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ["1", "Create a task", "Write down one concrete thing."],
                      ["2", "Make a category", "Group tasks the way you think about them."],
                      ["3", "Invite a friend", "Send a request by email from your profile."],
                      ["4", "Share a task", "Choose that friend when you edit the task."],
                    ].map(([step, title, body]) => (
                      <li key={step} className="rounded-lg border border-line bg-paper-sunken p-4">
                        <p className={FIELD_LABEL_CLASS}>Step {step}</p>
                        <p className="mt-2 text-body-sm font-bold text-ink">{title}</p>
                        <p className="mt-1 text-caption text-ink-muted">{body}</p>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <Button size="lg" onClick={() => setIsCreateOpen(true)}>
                      <Plus className="h-5 w-5" aria-hidden="true" />
                      Create your first task
                    </Button>
                    <Button size="lg" variant="outline" onClick={() => router.push("/profile")}>
                      Invite a friend
                    </Button>
                  </div>
                </div>
              ) : (
                <StatusPanel
                  icon={CheckCircle2}
                  title="Nothing open right now"
                  description="Everything you had is done. Add the next thing when it comes up."
                  action={{ label: "New task", onClick: () => setIsCreateOpen(true) }}
                />
              )
            ) : (
              <MasonryColumns
                items={activeTodos}
                getKey={(todo) => todo.id}
                getItemWeight={getTaskWeight}
                columns={TASK_GRID_COLUMNS}
                breakpoints={TASK_GRID_BREAKPOINTS}
                renderItem={(todo) => (
                  <TodoCard
                    todo={todo}
                    variant="default"
                    onComplete={() => handleComplete(todo.id)}
                    onDelete={() => requestDelete(todo)}
                    onEdit={() => setEditingTodo(todo)}
                    onToggleHidden={() => handleToggleHidden(todo.id)}
                    onJoin={async () => handleJoin(todo.id)}
                  />
                )}
              />
            )}

          </>
        )}

        {/* Outside the loading branch: the pager stays mounted while the next page loads,
            so the button just pressed keeps keyboard focus instead of unmounting under it. */}
        {!error ? (
          <Pagination className="pt-4" page={currentPage} totalPages={totalPages} onChange={handlePageChange} />
        ) : null}
      </section>

      <AnimatePresence>
        {editingTodo && (
          <EditTodoModal
            todo={editingTodo}
            categories={categories}
            onClose={() => setEditingTodo(null)}
            onSave={payload => handleUpdate(editingTodo.id, payload)}
            onSaveViewerPreference={(payload) => handleSaveViewerPreference(editingTodo.id, payload.viewerCategoryId)}
            onCreateCategory={fetchCategories}
            onDeleteCategory={handleDeleteCategory}
            onDescriptionChange={(desc) => {
              const update = (prev: Todo[]) => prev.map(t => t.id === editingTodo.id ? { ...t, description: desc } : t)
              setTodos(update)
              setStatsTodos(update)
              setEditingTodo(prev => prev ? { ...prev, description: desc } : null)
            }}
            onLeave={editingTodo ? async () => handleLeave(editingTodo.id) : undefined}
            onStartWork={editingTodo ? async () => handleJoin(editingTodo.id) : undefined}
            onCompleteTask={editingTodo ? async () => handleComplete(editingTodo.id) : undefined}
            onDuplicate={editingTodo ? async () => handleDuplicate(editingTodo.id) : undefined}
          />
        )}
      </AnimatePresence>

      {/*
        `C` means the same thing on every screen that has it: capture, one field.
        Both pages previously bound `C` to the full create panel, which asks for
        priority, date, category and audience before it will take a task — the
        opposite of capture, and not what the keyboard map promises. The panel is
        still here; it is opened by pressing its own header, which is always on
        screen, or from the command palette.
      */}
      <QuickCapture onCapture={handleQuickCapture} hidden={!!editingTodo || isCreateOpen} />

      <UndoBar pending={undoable.pending} onUndo={undoable.undo} />

    </div>
  )
}
