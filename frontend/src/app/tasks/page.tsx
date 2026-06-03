"use client"

import Link from "next/link"
import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import { useCollapseScroll } from "@/hooks/use-collapse-scroll"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Plus, CheckCircle2, ChevronRight, History, X } from "lucide-react"
import axios from "axios"
import { api, setTaskHidden, fetchTaskById, setViewerPreference, parseApiResponse, type ApiResponse, joinTodo, leaveTodo } from "@/lib/api"
import { ensureFriendNames } from "@/lib/friend-names"
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
  { ssr: false },
)
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { sortTasks, getTaskWeight } from "@/utils/sort-tasks"
import { applyCategoryPatch } from "@/utils/todo-utils"
import { TASK_CREATED_EVENT } from "@/lib/events"
import { EASE_OUT_EXPO, SPRING_GENTLE } from "@/lib/animations"
import { readFilter, writeFilter } from "@/utils/category-filter"
import { CategoryFilterModal } from "@/components/todos/category-filter-modal"
import { QuickFilterBar } from "@/components/todos/quick-filter-bar"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"

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
  const [deletingTodo, setDeletingTodo] = useState<Todo | null>(null)
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([])
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)

  // Smooth scroll to top when large panels collapse
  useCollapseScroll(isCreateOpen)
  useCollapseScroll(showCompleted)

  // Hydrate the persisted category filter after mount
  useEffect(() => {
    setFilterCategoryIds(readFilter())
  }, [])

  // Press "F" — toggle category filter modal (skip when typing in inputs or create panel open)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f") return
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (isCreateOpen) return
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return
      e.preventDefault()
      setIsCategoryModalOpen(prev => !prev)
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [isCreateOpen])

  // Press "C" — open create panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "c") return
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (isCreateOpen) return
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return
      e.preventDefault()
      setIsCreateOpen(true)
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [isCreateOpen])

  const handleFilterChange = useCallback((ids: string[]) => {
    setFilterCategoryIds(ids)
    writeFilter(ids)
  }, [])

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

  const fetchActiveTodos = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
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
      addToast({ type: "error", title: "Failed to load tasks" })
    } finally {
      if (!signal?.aborted) setLoading(false)
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
      fetchActiveTodos(controller.signal),
      fetchCompletedPreview(controller.signal),
      fetchCategories(controller.signal),
    ])
    return () => controller.abort()
  }, [isAuthenticated, hasHydrated, router, fetchActiveTodos, fetchCompletedPreview, fetchCategories, clearAuth])

  useEffect(() => {
    const handler = () => { void fetchActiveTodos() }
    window.addEventListener(TASK_CREATED_EVENT, handler)
    return () => window.removeEventListener(TASK_CREATED_EVENT, handler)
  }, [fetchActiveTodos])

  const handleComplete = async (id: string) => {
    const existingTodo = todosRef.current.find((t) => t.id === id) ?? completedPreviewRef.current.find((t) => t.id === id)
    if (!existingTodo) return

    const currentUserId = user?.userId
    const isOwner = isTodoOwner(existingTodo, currentUserId)
    const isShared = existingTodo.isPublic || (existingTodo.sharedWithUserIds?.length ?? 0) > 0

    if (!isOwner && isShared) {
      const wasCompleted = existingTodo.isCompletedByViewer === true
      try {
        const result = await setViewerPreference(id, { completedByViewer: !wasCompleted })
        setTodos((prev) => prev.map((t) =>
          t.id !== id ? t : { ...t, isCompletedByViewer: result.completedByViewer ?? false }
        ))
        if (!wasCompleted) {
          setTodos((prev) => prev.filter((t) => t.id !== id))
          await fetchCompletedPreview()
        } else {
          await Promise.all([fetchActiveTodos(), fetchCompletedPreview()])
        }
        addToast({ type: "success", title: wasCompleted ? "Task reopened!" : "Task completed!" })
      } catch (error) {
        console.error("Failed to update viewer completion:", error)
        addToast({ type: "error", title: "Failed to update task" })
      }
      return
    }

    const isCompleted = isCompletedTodoStatus(existingTodo.status)
    const newStatus = isCompleted ? "todo" : "done"

    try {
      await api.put(`/todos/api/v1/todos/${id}`, { status: newStatus })

      if (isCompleted) {
        await Promise.all([fetchActiveTodos(), fetchCompletedPreview()])
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

  const confirmDelete = async () => {
    if (!deletingTodo) return

    const todoToDelete = deletingTodo

    try {
      await api.delete(`/todos/api/v1/todos/${todoToDelete.id}`)

      if (isCompletedTodoStatus(todoToDelete.status)) {
        await fetchCompletedPreview()
      } else {
        setTodos((prev) => prev.filter((t) => t.id !== todoToDelete.id))
      }

      addToast({ type: "success", title: "Task deleted" })
    } catch (error) {
      console.error("Failed to delete todo:", error)
      addToast({ type: "error", title: "Failed to delete task" })
    } finally {
      setDeletingTodo(null)
    }
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
      await api.post("/todos/api/v1/todos", payload)
      setIsCreateOpen(false)
      await fetchActiveTodos()
      addToast({ type: "success", title: "Task created!" })
    } catch (error) {
      console.error("Failed to create todo:", error)
      addToast({ type: "error", title: "Failed to create task" })
    }
  }

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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-1">
            All Tasks
          </p>
          <h1 className="text-3xl font-bold text-gray-900">Tasks</h1>
          <p className="text-gray-500 mt-1">
            {activeCount} active · {doneCount} done · {totalCount} total
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button
            onClick={() => setIsCreateOpen(!isCreateOpen)}
            variant={isCreateOpen ? "outline" : "default"}
            className={isCreateOpen ? "border-gray-300 text-gray-700 hover:bg-gray-100 hover:text-gray-900 hover:border-gray-400 transition-[background-color,border-color,color]" : ""}
          >
            <AnimatePresence mode="wait" initial={false}>
              {isCreateOpen ? (
                <motion.span
                  key="close"
                  initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center gap-1.5"
                >
                  <X className="h-4 w-4" />
                  Close
                </motion.span>
              ) : (
                <motion.span
                  key="new"
                  initial={{ opacity: 0, rotate: 90, scale: 0.8 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: -90, scale: 0.8 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  New Task
                  <kbd className="hidden md:flex font-mono bg-white/20 text-white/70 px-1.5 py-0.5 rounded text-[10px] font-bold border border-white/20 leading-tight">c</kbd>
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </div>
      </div>

      {/* The quick-filter plate and the create panel are two INDEPENDENT presences (not a single
          `mode="wait"` swap). A `mode="wait"` swap dropped the filter's enter animation when the
          create panel closed on submit, because `handleCreate` flips `isCreateOpen` and then
          immediately re-renders the page via `fetchActiveTodos` (`setLoading`), interrupting the
          deferred enter and leaving the filter collapsed at height 0. Decoupling them makes each
          presence self-contained, so the filter always re-reveals after a task is created. */}
      <AnimatePresence initial={false}>
        {!isCreateOpen && (
          <motion.div
            key="quick-filter"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <QuickFilterBar
              categories={categories}
              selectedIds={filterCategoryIds}
              onOpen={() => setIsCategoryModalOpen(true)}
              onClear={() => handleFilterChange([])}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {isCreateOpen && (
          <motion.div
            key="create-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <CreateTodoPanel
              isOpen={true}
              onToggle={() => setIsCreateOpen(false)}
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
          </motion.div>
        )}
      </AnimatePresence>

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
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ ...SPRING_GENTLE, delay: 0.1 }}
          className="rounded-2xl border border-dashed border-gray-200 bg-white p-16 text-center"
        >
          <motion.div
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", repeatDelay: 1 }}
            className="mx-auto h-14 w-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-3"
          >
            <CheckCircle2 className="h-7 w-7 text-gray-200" />
          </motion.div>
          <p className="font-semibold text-gray-900 mb-1">No tasks yet</p>
          <p className="text-sm text-gray-400 mb-4">
            Create your first task to get started
          </p>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create task
          </Button>
        </motion.div>
      ) : (
        <div className="space-y-10">
          <div>
            {visibleTodos.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
                {filterCategoryIds.length > 0 ? (
                  <>
                    <p className="text-sm text-gray-400 font-medium">No tasks in selected categories.</p>
                    <button
                      onClick={() => handleFilterChange([])}
                      className="text-xs text-gray-400 hover:text-gray-900 font-medium mt-2 transition-colors"
                    >
                      Clear filter
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 font-medium">No active tasks.</p>
                )}
              </div>
            ) : (
              <>
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
                    onComplete={() => handleComplete(todo.id)}
                    onDelete={() => setDeletingTodo(todo)}
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
                className="flex items-center gap-3 text-sm font-black text-gray-400 hover:text-black transition-colors group px-1 w-full"
              >
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center transition-[background-color,color] ${showCompleted ? "bg-black text-white" : "bg-gray-100 text-gray-400 group-hover:bg-gray-200 group-hover:text-black"}`}>
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
                    transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
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
                                onDelete={() => setDeletingTodo(todo)}
                                onEdit={() => setEditingTodo(todo)}
                                onToggleHidden={() => handleToggleHidden(todo.id)}
                              />
                            )}
                          />
                          <div className="rounded-[1.75rem] border border-gray-200 bg-white/90 p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">
                                {completedTotalCount > COMPLETED_PREVIEW_SIZE
                                  ? `Showing latest ${COMPLETED_PREVIEW_SIZE}`
                                  : "Completed archive preview"}
                              </p>
                              <p className="text-sm text-gray-500 font-medium">
                                {completedTotalCount > COMPLETED_PREVIEW_SIZE
                                  ? `Open the archive to browse all ${completedTotalCount} completed tasks.`
                                  : "All completed tasks currently fit in this section."}
                              </p>
                            </div>
                            <Button asChild size="sm" className="rounded-xl font-bold shadow-lg shadow-black/10">
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

      <ConfirmDialog
        isOpen={!!deletingTodo}
        onClose={() => setDeletingTodo(null)}
        onConfirm={confirmDelete}
        title="Delete Task?"
        description={`Are you sure you want to delete "${deletingTodo?.title}"? This action cannot be undone.`}
        confirmText="Delete Task"
      />

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
