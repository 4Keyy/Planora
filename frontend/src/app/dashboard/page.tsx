"use client"

import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { useCollapseScroll } from "@/hooks/use-collapse-scroll"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Plus, CheckCircle2 } from "lucide-react"
import { api, parseApiResponse, setTaskHidden, fetchTaskById, setViewerPreference, type ApiResponse } from "@/lib/api"
import { ensureFriendNames } from "@/lib/friend-names"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Todo, toApiTodoStatus, type CreateTodoPayload, type UpdateTodoPayload } from "@/types/todo"
import { TodoCard } from "@/components/todos/todo-card"
import { useToastStore } from "@/store/toast"
import { Category } from "@/types/category"
import { EditTodoModal } from "@/components/todos/edit-todo-modal"
import { CreateTodoPanel } from "@/components/todos/create-todo-panel"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { MasonryColumns } from "@/components/ui/masonry-columns"
import { sortTasks, getTaskWeight } from "@/utils/sort-tasks"
import { applyCategoryPatch } from "@/utils/todo-utils"
import { TASK_CREATED_EVENT } from "@/lib/events"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"

const PROGRESS_TRANSITION = { duration: 1.5, ease: "easeOut" } as const
const DASHBOARD_MASONRY_BREAKPOINTS = [
  { maxWidth: 1200, columns: 2 },
  { maxWidth: 768, columns: 1 },
]
const FIRST_RUN_STORAGE_KEY = "planora-first-run"
type CategoryResponse = Category[] | { items?: Category[]; value?: Category[] | { items?: Category[] } }

const normalizeCategoryResponse = (response: CategoryResponse): Category[] => {
  const data = Array.isArray(response) ? response : response.value ?? response
  return Array.isArray(data) ? data : data.items ?? []
}

function ProgressCircle({ value, total }: { value: number; total: number }) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-3"
    >
      <div className="relative h-24 w-24 md:h-32 md:w-32">
        <svg className="h-full w-full drop-shadow-sm" viewBox="0 0 36 36">
          {/* Background circle */}
          <path
            className="text-gray-100"
            stroke="currentColor"
            strokeWidth="3.5"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          {/* Progress path with animation */}
          <motion.path
            initial={{ strokeDasharray: "0, 100" }}
            animate={{ strokeDasharray: `${percentage}, 100` }}
            transition={{ ...PROGRESS_TRANSITION, type: "spring", stiffness: 80 }}
            className="text-black"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
          />
        </svg>
        <motion.div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-base md:text-2xl font-black text-gray-900 tracking-tighter"
          >
            {percentage}<span className="text-sm md:text-lg">%</span>
          </motion.span>
        </motion.div>
      </div>
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-[9px] md:text-[11px] font-black text-gray-400 uppercase tracking-[0.15em]"
      >
        Weekly Progress
      </motion.span>
    </motion.div>
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
  const [deletingTodo, setDeletingTodo] = useState<Todo | null>(null)
  const [mounted, setMounted] = useState(false)
  const [firstRun, setFirstRun] = useState(false)
  const firstRunAutoOpenedRef = useRef(false)
  const friendNameCache = useRef<Map<string, string>>(new Map())
  const currentPageRef = useRef(currentPage)

  // Smooth scroll to top when create panel collapses
  useCollapseScroll(isCreateOpen)

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get<CategoryResponse>("/categories/api/v1/categories")
      setCategories(normalizeCategoryResponse(res.data))
    } catch { }
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

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get<{ items: Todo[] }>("/todos/api/v1/todos", {
        params: { pageNumber: 1, pageSize: 1000 },
      })
      const items = res.data.items ?? []
      const enriched = await enrichTodosWithAuthorNames(items)
      setStatsTodos(enriched)
    } catch (err) {
      console.error("Failed to fetch stats:", err)
    }
  }, [enrichTodosWithAuthorNames])

  // Keep ref in sync so fetchTodos can default to the current page without
  // capturing it in its dep array (which would cause the event listener to
  // be torn down and re-added on every pagination click).
  useEffect(() => { currentPageRef.current = currentPage }, [currentPage])

  const fetchTodos = useCallback(async (page = currentPageRef.current) => {
    try {
      setLoading(true)
      const res = await api.get<{ items: Todo[]; totalCount: number }>("/todos/api/v1/todos", {
        params: {
          pageNumber: page,
          pageSize,
          status: "Todo,InProgress",
        },
      })
      const items = res.data.items ?? []
      const enriched = await enrichTodosWithAuthorNames(items)
      setTodos(enriched)
      setTotalCount(res.data.totalCount ?? 0)
      setLastFetchedPage(page)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load todos")
    } finally {
      setLoading(false)
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

  // Navbar quick-create fired a task — refresh without a page reload
  useEffect(() => {
    const handler = () => {
      setCurrentPage(1)
      void Promise.all([fetchTodos(1), fetchStats()])
    }
    window.addEventListener(TASK_CREATED_EVENT, handler)
    return () => window.removeEventListener(TASK_CREATED_EVENT, handler)
  }, [fetchTodos, fetchStats])

  // Press "C" — open create panel (skip when typing or panel already open)
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

    // Only fetch data if authenticated
    fetchTodos()
    fetchStats()
    fetchCategories()
  }, [isAuthenticated, hasHydrated, mounted, fetchTodos, fetchStats, fetchCategories, clearAuth, router])

  const activeStatsTodos = useMemo(() =>
    statsTodos.filter(t => { const s = String(t.status).toLowerCase(); return s !== "done" && s !== "completed" }),
    [statsTodos]
  )

  const allCompletedStatsTodos = useMemo(() =>
    statsTodos.filter(t => { const s = String(t.status).toLowerCase(); return s === "done" || s === "completed" }),
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

  const totalForStats = activeStatsTodos.length + recentCompletedStatsTodos.length

  // Теперь todos содержит только активные задачи из fetchTodos
  const activeTodos = useMemo(() => sortTasks(todos), [todos])

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
    await api.post("/todos/api/v1/todos", payload)
    setIsCreateOpen(false)
    setFirstRun(false)
    try {
      sessionStorage.removeItem(FIRST_RUN_STORAGE_KEY)
    } catch { }
    setCurrentPage(1)
    await Promise.all([fetchTodos(1), fetchStats()])
    addToast({ type: "success", title: "Task created!" })
  }

  const confirmDelete = async () => {
    if (!deletingTodo) return
    try {
      await api.delete(`/todos/api/v1/todos/${deletingTodo.id}`)
      setTodos(prev => prev.filter(t => t.id !== deletingTodo.id))
      setStatsTodos(prev => prev.filter(t => t.id !== deletingTodo.id))
      
      const isCompleted = ["done", "completed"].includes(String(deletingTodo.status).toLowerCase())
      if (!isCompleted) {
        setTotalCount(prev => Math.max(0, prev - 1))
      }
      
      addToast({ type: "success", title: "Task deleted" })
    } catch { addToast({ type: "error", title: "Failed to delete" }) }
    finally { setDeletingTodo(null) }
  }

  const handleComplete = async (todoId: string) => {
    const existing = todos.find(t => t.id === todoId) || statsTodos.find(t => t.id === todoId)
    if (!existing) return

    const status = String(existing.status).toLowerCase()
    const isCompleted = status === "done" || status === "completed"
    const newStatus = isCompleted ? "todo" : "done"

    try {
      const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${todoId}`, { status: newStatus })
      const updated = parseApiResponse(res.data)
      
      // Если мы пометили задачу как выполненную, она должна исчезнуть из текущего списка активных задач
      if (!isCompleted) {
        setTodos(prev => prev.filter(t => t.id !== todoId))
        setTotalCount(prev => Math.max(0, prev - 1))
      } else {
        // Если вернули из выполненных, лучше обновить список, так как она может попасть на текущую страницу
        fetchTodos()
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
  }


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
      setEditingTodo(null)
      addToast({ type: "success", title: "Task updated" })
    } catch { addToast({ type: "error", title: "Failed to update" }) }
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
      setEditingTodo(null)
      addToast({ type: "success", title: "Your category was saved" })
    } catch {
      addToast({ type: "error", title: "Failed to save your category" })
    }
  }, [todos, statsTodos, addToast])

  const handleToggleHidden = useCallback(async (todoId: string) => {
    const existing = todos.find(t => t.id === todoId) ?? statsTodos.find(t => t.id === todoId)
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
  }, [todos, statsTodos, addToast, user?.userId])

  const handleDeleteCategory = async (categoryId: string) => {
    try {
      await api.delete(`/categories/api/v1/categories/${categoryId}`)
      await fetchCategories()
      await Promise.all([fetchTodos(), fetchStats()])
    } catch { }
  }

  const totalPages = Math.ceil(totalCount / pageSize)
  const totalCountForStats = totalForStats
  const completedCountForStats = recentCompletedStatsTodos.length

  return (
    <div className="space-y-6 md:space-y-10 pb-10">
      {/* Header section with Progress */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gradient-to-br from-white via-white to-gray-50 rounded-2xl p-6 md:p-8 shadow-card border border-gray-100 relative overflow-hidden group hover:shadow-lg transition-all duration-500"
      >
        {/* Decorative background elements */}
        <motion.div
          animate={{ opacity: [0.02, 0.05, 0.02] }}
          transition={{ duration: 6, repeat: Infinity }}
          className="absolute top-0 right-0 w-80 h-80 bg-black rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl pointer-events-none opacity-[0.02]"
        />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-gray-400 rounded-full translate-y-1/3 -translate-x-1/3 blur-3xl pointer-events-none opacity-[0.01]" />

        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="relative z-10 space-y-3"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="inline-flex items-center px-4 py-1.5 rounded-full bg-black/5 border border-black/10 mb-1"
          >
            <p className="text-[10px] font-black text-black uppercase tracking-[0.2em]">Workspace Overview</p>
          </motion.div>
          <h1 className="text-2xl md:text-3xl xl:text-4xl font-black text-gray-900 tracking-tight leading-tight">
            You have{" "}
            <motion.span
              key={activeStatsTodos.length}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 15 }}
              className="text-black inline-flex items-center px-2 py-1 rounded-xl bg-black/5 border border-black/10 hover:scale-110 transition-transform cursor-default font-black"
            >
              {activeStatsTodos.length}
            </motion.span>{" "}
            life tasks.
          </h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="relative z-10 flex items-center justify-center md:justify-end gap-6 bg-white/60 backdrop-blur-xl rounded-2xl p-5 border border-white/80 shadow-sm self-center md:self-auto min-w-[200px] hover:shadow-md transition-all"
        >
          <ProgressCircle value={completedCountForStats} total={totalCountForStats} />
          <motion.div className="h-12 w-px bg-gradient-to-b from-transparent via-gray-200 to-transparent hidden sm:block" />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="hidden sm:flex flex-col justify-center"
          >
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">Weekly Stats</span>
            <motion.span className="text-2xl font-black text-gray-900 leading-none">{completedCountForStats}</motion.span>
            <span className="text-[10px] font-bold text-gray-500 mt-0.5">Completed</span>
          </motion.div>
        </motion.div>
      </motion.div>
      
      {/* Main grid */}
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Todos */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight flex items-center gap-3">
              Active Tasks
              <span className="text-[10px] bg-gray-900 text-white px-2 py-0.5 rounded-full uppercase tracking-widest">{totalCount}</span>
            </h2>
            <Button size="sm" variant="ghost" onClick={() => router.push("/todos")} className="text-xs font-bold text-gray-400 hover:text-black transition-colors">
              All tasks →
            </Button>
          </div>

          {loading && (
            <MasonryColumns
              items={[...Array(pageSize)].map((_, i) => ({ id: `skeleton-${i}` }))}
              getKey={(item) => item.id}
              renderItem={() => <TodoSkeleton />}
              columns={3}
              breakpoints={DASHBOARD_MASONRY_BREAKPOINTS}
            />
          )}

          {error && !loading && (
            <div className="rounded-2xl bg-red-50 border border-red-100 p-5 text-sm text-red-700">{error}</div>
          )}

          {!loading && !error && (
            <>
              {activeTodos.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 25 }}
                  className="rounded-2xl border-2 border-dashed border-gray-200 bg-gradient-to-br from-white via-gray-50 to-gray-50 p-12 md:p-16 text-center shadow-sm hover:shadow-md transition-all"
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 }}
                    className="mx-auto h-20 w-20 rounded-2xl bg-gradient-to-br from-green-50 to-gray-50 flex items-center justify-center mb-6 border border-green-100"
                  >
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <CheckCircle2 className="h-10 w-10 text-green-400" />
                    </motion.div>
                  </motion.div>
                  <motion.h3
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="text-2xl font-black text-gray-900 mb-2"
                  >
                    {firstRun ? "Welcome to Planora" : "Perfectly Clear!"}
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="text-sm text-gray-500 mb-8 font-medium max-w-sm mx-auto leading-relaxed"
                  >
                    {firstRun
                      ? "Start with one task, then invite the person you want to coordinate with."
                      : "You have no active tasks at the moment. Time to relax or create something new!"}
                  </motion.p>
                  {firstRun && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.35 }}
                      className="mx-auto mb-8 grid max-w-3xl gap-3 text-left sm:grid-cols-2 lg:grid-cols-4"
                    >
                      {[
                        ["1", "Create first task", "Capture one concrete thing."],
                        ["2", "Create/share category", "Use a private category if needed."],
                        ["3", "Invite first friend", "Send a request by email."],
                        ["4", "Share a task", "Choose that friend in the task form."],
                      ].map(([step, title, body]) => (
                        <div key={step} className="rounded-xl border border-gray-100 bg-white/80 p-3">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Step {step}</div>
                          <div className="mt-2 text-sm font-bold text-gray-900">{title}</div>
                          <div className="mt-1 text-xs text-gray-500 leading-relaxed">{body}</div>
                        </div>
                      ))}
                    </motion.div>
                  )}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="flex flex-col sm:flex-row items-center justify-center gap-3"
                  >
                    <Button size="lg" onClick={() => setIsCreateOpen(true)} className="rounded-xl font-bold shadow-lg shadow-black/20 hover:-translate-y-1">
                      <Plus className="h-5 w-5 mr-2" />
                      {firstRun ? "Create first task" : "Create New Task"}
                    </Button>
                    {firstRun && (
                      <>
                        <Button
                          size="lg"
                          variant="outline"
                          onClick={() => router.push("/categories")}
                          className="rounded-xl font-bold"
                        >
                          Create category
                        </Button>
                        <Button
                          size="lg"
                          variant="outline"
                          onClick={() => router.push("/profile")}
                          className="rounded-xl font-bold"
                        >
                          Invite friend
                        </Button>
                      </>
                    )}
                  </motion.div>
                </motion.div>
              ) : (
                <MasonryColumns
                  items={activeTodos}
                  getKey={(todo) => todo.id}
                  getItemWeight={getTaskWeight}
                  columns={3}
                  breakpoints={DASHBOARD_MASONRY_BREAKPOINTS}
                  renderItem={(todo) => (
                    <TodoCard
                      todo={todo}
                      variant="default"
                      onComplete={() => handleComplete(todo.id)}
                      onDelete={() => setDeletingTodo(todo)}
                      onEdit={() => setEditingTodo(todo)}
                      onToggleHidden={() => handleToggleHidden(todo.id)}
                    />
                  )}
                />
              )}

              {/* Pagination - Beautiful */}
              {totalPages > 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-center gap-2 pt-8 pb-4"
                >
                  <motion.div whileHover={{ scale: 1.05 }}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCurrentPage(p => Math.max(1, p - 1))
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      disabled={currentPage === 1}
                      className="rounded-xl border-gray-300 font-bold px-5 hover:border-gray-400 hover:shadow-md"
                    >
                      ← Previous
                    </Button>
                  </motion.div>

                  <div className="flex items-center gap-1.5 mx-2">
                    {[...Array(totalPages)].map((_, i) => {
                      const pageNum = i + 1;
                      if (
                        pageNum === 1 ||
                        pageNum === totalPages ||
                        (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
                      ) {
                        return (
                          <motion.button
                            key={pageNum}
                            whileHover={{ scale: 1.15 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => {
                              setCurrentPage(pageNum)
                              window.scrollTo({ top: 0, behavior: 'smooth' })
                            }}
                            className={cn(
                              "w-9 h-9 rounded-lg text-xs font-bold transition-all duration-200 border",
                              currentPage === pageNum
                                ? "bg-gradient-to-br from-black to-gray-900 text-white shadow-lg shadow-black/30 scale-110 border-black"
                                : "text-gray-600 hover:bg-gray-100 hover:text-black hover:border-gray-300 border-gray-200"
                            )}
                          >
                            {pageNum}
                          </motion.button>
                        )
                      }
                      if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                        return (
                          <motion.span
                            key={pageNum}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-gray-300 font-light px-0.5"
                          >
                            ···
                          </motion.span>
                        )
                      }
                      return null;
                    })}
                  </div>

                  <motion.div whileHover={{ scale: 1.05 }}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCurrentPage(p => Math.min(totalPages, p + 1))
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      disabled={currentPage >= totalPages}
                      className="rounded-xl border-gray-300 font-bold px-5 hover:border-gray-400 hover:shadow-md"
                    >
                      Next →
                    </Button>
                  </motion.div>
                </motion.div>
              )}

            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          <CreateTodoPanel
            isOpen={isCreateOpen}
            onToggle={() => setIsCreateOpen(!isCreateOpen)}
            categories={categories}
            onSubmit={handleCreate}
            onCreateCategory={fetchCategories}
            onDeleteCategory={handleDeleteCategory}
            shortcutHint="c"
          />

          <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 text-[10px] text-gray-400 text-center font-bold uppercase tracking-[0.2em]">
            Planora Beta 0.1 · Local Dev
          </div>
        </div>
      </div>

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
    </div>
  )
}
