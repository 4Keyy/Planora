"use client"

import Link from "next/link"
import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Plus, CheckCircle2, ChevronRight, History, SlidersHorizontal, X } from "lucide-react"
import { api, setTaskHidden, fetchTaskById, setViewerPreference, parseApiResponse, type ApiResponse, joinTodo, leaveTodo } from "@/lib/api"
import { ensureFriendNames } from "@/lib/friend-names"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Todo, PagedTodosResponse, type CreateTodoPayload, type UpdateTodoPayload, isCompletedTodoStatus, isTodoOwner, sameUserId, toApiTodoStatus } from "@/types/todo"
import { TodoCard } from "@/components/todos/todo-card"
import { MasonryColumns } from "@/components/ui/masonry-columns"
import { useToastStore } from "@/store/toast"
import { Category, type CategoryListResponse, toCategoryList } from "@/types/category"
import { EditTodoModal } from "@/components/todos/edit-todo-modal"
import { CreateTodoPanel } from "@/components/todos/create-todo-panel"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { sortTasks, getTaskWeight } from "@/utils/sort-tasks"
import { applyCategoryPatch } from "@/utils/todo-utils"
import { TASK_CREATED_EVENT } from "@/lib/events"
import { EASE_OUT_EXPO, SPRING_GENTLE } from "@/lib/animations"
import { readFilter, writeFilter, readHintSeen, writeHintSeen } from "@/utils/category-filter"
import { CategoryFilterModal } from "@/components/todos/category-filter-modal"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { ICON_MAP } from "@/lib/icon-map"

const ACTIVE_PAGE_SIZE = 200
const COMPLETED_PREVIEW_SIZE = 20
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

export default function TodosPage() {
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

  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  const [deletingTodo, setDeletingTodo] = useState<Todo | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([])
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)
  const hintDismissedRef = useRef<boolean>(false)
  // Hydrate filter + hint state from localStorage after mount
  useEffect(() => {
    setFilterCategoryIds(readFilter())
    const seen = readHintSeen()
    setHintDismissed(seen)
    hintDismissedRef.current = seen
  }, [])

  // Auto-dismiss hint after 7 seconds
  useEffect(() => {
    if (hintDismissed) return
    const t = setTimeout(() => {
      setHintDismissed(true)
      hintDismissedRef.current = true
      writeHintSeen()
    }, 7000)
    return () => clearTimeout(t)
  }, [hintDismissed])

  // Press "F" — toggle category filter modal (skip when typing in inputs or create panel open)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Use 'F' key (filter) as it's very intuitive and unlikely to conflict with system keys
      if (e.key.toLowerCase() !== "f") return
      
      // Skip if user is holding any modifier (Ctrl, Alt, Meta, Shift) to avoid breaking system/browser shortcuts
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      
      // Skip if create panel is open
      if (isCreateOpen) return
      
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return
      
      e.preventDefault()
      setIsCategoryModalOpen(prev => !prev)
      
      // Dismiss hint on first use
      if (!hintDismissedRef.current) {
        setHintDismissed(true)
        hintDismissedRef.current = true
        writeHintSeen()
      }
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

  const dismissHint = useCallback(() => {
    setHintDismissed(true)
    writeHintSeen()
  }, [])

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<CategoryListResponse>>("/categories/api/v1/categories")
      setCategories(toCategoryList(parseApiResponse<CategoryListResponse>(res.data)))
    } catch (error) {
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

  const fetchActiveTodos = useCallback(async () => {
    setLoading(true)
    try {
      const all: Todo[] = []
      let page = 1
      let totalCount: number | null = null

      while (true) {
        const res = await api.get<PagedTodosResponse>("/todos/api/v1/todos", {
          params: { pageNumber: page, pageSize: ACTIVE_PAGE_SIZE, isCompleted: false },
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

      const enriched = await enrichTodosWithAuthorNames(all)
      setTodos(enriched)
    } catch (error) {
      console.error("Failed to fetch active todos:", error)
      addToast({ type: "error", title: "Failed to load todos" })
    } finally {
      setLoading(false)
    }
  }, [addToast, enrichTodosWithAuthorNames])

  const fetchCompletedPreview = useCallback(async () => {
    setCompletedLoading(true)
    try {
      const res = await api.get<PagedTodosResponse>("/todos/api/v1/todos", {
        params: { pageNumber: 1, pageSize: COMPLETED_PREVIEW_SIZE, isCompleted: true },
      })
      const items = res.data.items ?? []
      const enriched = await enrichTodosWithAuthorNames(items)
      setCompletedPreview(enriched)
      setCompletedTotalCount(res.data.totalCount ?? enriched.length)
    } catch (error) {
      console.error("Failed to fetch completed preview:", error)
      setCompletedPreview([])
      setCompletedTotalCount(0)
    } finally {
      setCompletedLoading(false)
    }
  }, [enrichTodosWithAuthorNames])

  useEffect(() => {
    if (!hasHydrated) return

    if (!isAuthenticated || !useAuthStore.getState().isTokenValid()) {
      clearAuth()
      router.replace("/auth/login")
      return
    }

    fetchActiveTodos()
    fetchCompletedPreview()
    fetchCategories()
  }, [isAuthenticated, hasHydrated, router, fetchActiveTodos, fetchCompletedPreview, fetchCategories, clearAuth])

  useEffect(() => {
    const handler = () => { void fetchActiveTodos() }
    window.addEventListener(TASK_CREATED_EVENT, handler)
    return () => window.removeEventListener(TASK_CREATED_EVENT, handler)
  }, [fetchActiveTodos])

  const handleComplete = async (id: string) => {
    const existingTodo = todos.find((t) => t.id === id) ?? completedPreview.find((t) => t.id === id)
    if (!existingTodo) return

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

      setEditingTodo(null)
      addToast({ type: "success", title: "Task updated" })
    } catch (error) {
      console.error("Failed to update todo:", error)
      addToast({ type: "error", title: "Failed to update task" })
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

      setEditingTodo(null)
      addToast({ type: "success", title: "Your category was saved" })
    } catch (error) {
      console.error("Failed to update viewer preference:", error)
      addToast({ type: "error", title: "Failed to save your category" })
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
    const existing = todos.find(t => t.id === todoId) ?? completedPreview.find(t => t.id === todoId)
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

        // Merge PATCH response — preserve all existing fields, overlay only what server confirmed
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
  }, [todos, completedPreview, user?.userId, addToast])

  const activeCount = todos.length
  const doneCount = completedTotalCount
  const totalCount = activeCount + doneCount

  const sortedTodos = useMemo(() => sortTasks(todos), [todos])
  const sortedCompletedPreview = useMemo(() => sortTasks(completedPreview), [completedPreview])
  const visibleTodos = useMemo(() => {
    if (filterCategoryIds.length === 0) return sortedTodos
    return sortedTodos.filter(t => filterCategoryIds.includes(t.categoryId ?? ""))
  }, [sortedTodos, filterCategoryIds])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-1">
            All Tasks
          </p>
          <h1 className="text-3xl font-bold text-gray-900">Todos</h1>
          <p className="text-gray-500 mt-1">
            {activeCount} active · {doneCount} done · {totalCount} total
          </p>

          {/* Filter indicator — only when active */}
          <AnimatePresence>
            {filterCategoryIds.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-3 px-4 py-3 bg-gradient-to-r from-gray-50 to-white rounded-xl border border-gray-200 shadow-md hover:shadow-lg transition-all"
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="flex items-center gap-2">
                    {filterCategoryIds.map(id => {
                      const cat = categories.find(c => c.id === id)
                      const CatIcon = cat?.icon ? (ICON_MAP[cat.icon] ?? null) : null
                      return cat ? (
                        <motion.div
                          key={id}
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="h-7 w-7 rounded-lg flex items-center justify-center shadow-xs border border-gray-200"
                          style={{ backgroundColor: `${cat.color ?? "#9ca3af"}15` }}
                          title={cat.name}
                        >
                          {CatIcon ? (
                            <CatIcon className="h-4 w-4" style={{ color: cat.color ?? "#9ca3af" }} />
                          ) : (
                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.color ?? "#9ca3af" }} />
                          )}
                        </motion.div>
                      ) : null
                    })}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-900">
                      Filter Active
                    </span>
                    <span className="text-xs font-semibold text-gray-600">
                      {filterCategoryIds.length === 1 ? "1 category" : `${filterCategoryIds.length} categories`}
                    </span>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.2, rotate: 90 }}
                  whileTap={{ scale: 0.85 }}
                  onClick={() => handleFilterChange([])}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-black hover:bg-gray-100 transition-all font-bold text-lg flex-shrink-0"
                  aria-label="Clear category filter"
                >
                  ✕
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Onboarding hint — shown once, auto-dismisses */}
          <AnimatePresence>
            {!hintDismissed && !loading && categories.length > 0 && filterCategoryIds.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-1.5 mt-2"
              >
                <kbd className="font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[10px] border border-gray-200 leading-tight">
                  F
                </kbd>
                <span className="text-[11px] text-gray-400">filter by category</span>
                <button
                  onClick={dismissHint}
                  className="text-[10px] text-gray-300 hover:text-gray-500 transition-colors ml-0.5"
                  aria-label="Dismiss hint"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>
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

      {/* Quick Filter ↔ Create Panel — single slot, sequential transition (mode="wait") */}
      <AnimatePresence mode="wait">
        {!isCreateOpen ? (
          <motion.div
            key="quick-filter"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 1, 1] }}
            className="overflow-hidden"
          >
            <motion.div
              initial={{ y: -10, scale: 0.98, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: -6, scale: 0.98, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 1, 1] }}
              className="bg-white/50 backdrop-blur-sm border border-gray-100 rounded-[2rem] p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm w-full"
            >
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-2xl bg-black text-white flex items-center justify-center shadow-lg shadow-black/10">
                  <SlidersHorizontal className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Quick Filter</h3>
                  <p className="text-xs text-gray-500 font-medium">Manage your view by categories with ease.</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-100/80 rounded-xl border border-gray-200/50">
                  <kbd className="font-mono bg-white px-2 py-0.5 rounded text-[10px] font-black border border-gray-200 shadow-sm text-gray-600">F</kbd>
                  <span className="text-[11px] font-bold text-gray-600 ml-1">to filter</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl font-bold text-xs h-10 border-gray-200 hover:bg-black hover:text-white hover:border-black transition-[background-color,border-color,color] px-6"
                  onClick={() => setIsCategoryModalOpen(true)}
                >
                  Open Menu
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : (
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
              <MasonryColumns
                items={visibleTodos}
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
                        } catch {
                          addToast({ type: "error", title: "Could not update task" })
                        }
                      } else {
                        try {
                          const updated = await joinTodo(todo.id)
                          setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, ...updated } : t))
                        } catch {
                          addToast({ type: "error", title: "Could not join task" })
                        }
                      }
                    }}
                    onLeave={async () => {
                      if (isTodoOwner(todo, user?.userId)) {
                        try {
                          await api.put(`/todos/api/v1/todos/${todo.id}`, { status: "todo" })
                          setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, status: "Todo" } : t))
                        } catch {
                          addToast({ type: "error", title: "Could not update task" })
                        }
                      } else {
                        try {
                          await leaveTodo(todo.id)
                          setTodos((prev) => prev.map((t) =>
                            t.id === todo.id
                              ? { ...t, isWorking: false, workerCount: Math.max(0, (t.workerCount ?? 1) - 1) }
                              : t
                          ))
                        } catch {
                          addToast({ type: "error", title: "Could not leave task" })
                        }
                      }
                    }}
                  />
                )}
              />
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
                              <Link href="/todos/completed">
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
