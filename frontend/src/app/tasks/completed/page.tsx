"use client"

import Link from "next/link"
import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, CheckCircle2, History } from "lucide-react"
import { api, setTaskHidden, fetchTaskById, setViewerPreference, parseApiResponse, type ApiResponse } from "@/lib/api"
import { ensureFriendNames } from "@/lib/friend-names"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Todo, PagedTodosResponse, type UpdateTodoPayload, isTodoOwner, sameUserId, toApiTodoStatus } from "@/types/todo"
import { TodoCard } from "@/components/todos/todo-card"
import { MasonryColumns } from "@/components/ui/masonry-columns"
import { useToastStore } from "@/store/toast"
import { Category, type CategoryListResponse, toCategoryList } from "@/types/category"
import dynamic from "next/dynamic"
// Edit modal mounts only when the user clicks a completed task. Lazy-load
// keeps it out of the initial completed-page bundle; the framer-motion
// enter animation absorbs the chunk fetch on first open.
const EditTodoModal = dynamic(
  () => import("@/components/todos/edit-todo-modal").then((m) => ({ default: m.EditTodoModal })),
  { ssr: false },
)
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"
import { getTaskWeight } from "@/utils/sort-tasks"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { readFilter, writeFilter, readHintSeen, writeHintSeen } from "@/utils/category-filter"
import { CategoryFilterModal } from "@/components/todos/category-filter-modal"
import { ICON_MAP } from "@/lib/icon-map"

const PAGE_SIZE = 20
const COMPLETED_MASONRY_BREAKPOINTS = [
  { maxWidth: 1400, columns: 3 },
  { maxWidth: 900, columns: 2 },
  { maxWidth: 480, columns: 1 },
]

export default function CompletedTasksPage() {
  const router = useRouter()
  const addToast = useToastStore((s) => s.addToast)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const hasHydrated = useAuthStore(s => s.hasHydrated)
  const user = useAuthStore(s => s.user)

  const [todos, setTodos] = useState<Todo[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [lastFetchedPage, setLastFetchedPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  const [deletingTodo, setDeletingTodo] = useState<Todo | null>(null)
  // Category filter — same mechanism + shared persistence as the /tasks page.
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([])
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)
  const hintDismissedRef = useRef<boolean>(false)
  const friendNameCache = useRef<Map<string, string>>(new Map())

  // PERF: live mirror for the memoized TodoCard's (possibly stale) handler
  // closures to read from. See the equivalent note on the dashboard.
  const todosRef = useRef(todos)
  todosRef.current = todos

  // ── Category filter (mirrors /tasks: "F" hotkey + chip + shared persistence) ──
  useEffect(() => {
    setFilterCategoryIds(readFilter())
    const seen = readHintSeen()
    setHintDismissed(seen)
    hintDismissedRef.current = seen
  }, [])

  useEffect(() => {
    if (hintDismissed) return
    const t = setTimeout(() => {
      setHintDismissed(true)
      hintDismissedRef.current = true
      writeHintSeen()
    }, 7000)
    return () => clearTimeout(t)
  }, [hintDismissed])

  // Press "F" — toggle the category filter modal (ignored while typing).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f") return
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return
      e.preventDefault()
      setIsCategoryModalOpen(prev => !prev)
      if (!hintDismissedRef.current) {
        setHintDismissed(true)
        hintDismissedRef.current = true
        writeHintSeen()
      }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [])

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

  const fetchCompletedTodos = useCallback(async (page = currentPage) => {
    setLoading(true)
    setError(null)

    try {
      const res = await api.get<PagedTodosResponse>("/todos/api/v1/todos", {
        params: {
          pageNumber: page,
          pageSize: PAGE_SIZE,
          isCompleted: true,
        },
      })

      const items = res.data.items ?? []
      const enriched = await enrichTodosWithAuthorNames(items)

      setTodos(enriched)
      setTotalCount(res.data.totalCount ?? 0)
      setLastFetchedPage(page)
    } catch (err) {
      console.error("Failed to fetch completed todos:", err)
      setError(err instanceof Error ? err.message : "Failed to load completed tasks")
    } finally {
      setLoading(false)
    }
  }, [currentPage, enrichTodosWithAuthorNames])

  useEffect(() => {
    if (!hasHydrated) return

    if (!isAuthenticated || !useAuthStore.getState().isTokenValid()) {
      clearAuth()
      router.replace("/auth/login")
      return
    }

    fetchCompletedTodos()
    fetchCategories()
  }, [isAuthenticated, hasHydrated, router, fetchCompletedTodos, fetchCategories, clearAuth])

  useEffect(() => {
    if (loading) return

    if (totalCount === 0) {
      if (currentPage !== 1) setCurrentPage(1)
      return
    }

    const pages = Math.ceil(totalCount / PAGE_SIZE)
    if (currentPage > pages) {
      setCurrentPage(pages)
      return
    }

    if (todos.length === 0 && currentPage > 1 && lastFetchedPage === currentPage) {
      setCurrentPage(currentPage - 1)
    }
  }, [loading, totalCount, currentPage, todos.length, lastFetchedPage])

  const handleComplete = async (todoId: string) => {
    const existing = todosRef.current.find((t) => t.id === todoId)
    if (!existing) return

    try {
      await api.put(`/todos/api/v1/todos/${todoId}`, { status: "todo" })
      await fetchCompletedTodos(currentPage)
      addToast({ type: "success", title: "Task reopened!" })
    } catch (error) {
      console.error("Failed to reopen todo:", error)
      addToast({ type: "error", title: "Failed to update task" })
    }
  }

  const confirmDelete = async () => {
    if (!deletingTodo) return

    try {
      await api.delete(`/todos/api/v1/todos/${deletingTodo.id}`)
      await fetchCompletedTodos(currentPage)
      addToast({ type: "success", title: "Task deleted" })
    } catch (error) {
      console.error("Failed to delete todo:", error)
      addToast({ type: "error", title: "Failed to delete task" })
    } finally {
      setDeletingTodo(null)
    }
  }

  const handleUpdate = async (todoId: string, payload: UpdateTodoPayload) => {
    const existing = todos.find((t) => t.id === todoId)
    if (!existing) return

    try {
      const res = await api.put(`/todos/api/v1/todos/${todoId}`, {
        ...payload,
        status: toApiTodoStatus(existing.status),
      })
      const updated = parseApiResponse<Todo>(res.data)
      const authorName = existing.authorName ?? friendNameCache.current.get(updated.userId)

      setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...updated, authorName } : t)))
      setEditingTodo(null)
      addToast({ type: "success", title: "Task updated" })
    } catch (error) {
      console.error("Failed to update todo:", error)
      addToast({ type: "error", title: "Failed to update task" })
    }
  }

  const handleSaveViewerPreference = useCallback(async (todoId: string, viewerCategoryId: string | null) => {
    const existing = todos.find((t) => t.id === todoId)
    if (!existing) return

    try {
      await setViewerPreference(todoId, {
        viewerCategoryId,
        updateViewerCategory: true,
      })

      const fullTask = await fetchTaskById(todoId)
      const authorName = existing.authorName ?? friendNameCache.current.get(fullTask.userId)
      const enriched = authorName ? { ...fullTask, authorName } : fullTask

      setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, ...enriched } : t)))
      setEditingTodo(null)
      addToast({ type: "success", title: "Your category was saved" })
    } catch (error) {
      console.error("Failed to update viewer preference:", error)
      addToast({ type: "error", title: "Failed to save your category" })
    }
  }, [todos, addToast])

  const handleToggleHidden = useCallback(async (todoId: string) => {
    const existing = todosRef.current.find(t => t.id === todoId)
    if (!existing) return
    const newHidden = !(existing.hidden ?? false)
    const isOwner = isTodoOwner(existing, user?.userId)
    const canOptimisticallyToggle = isOwner || newHidden

    if (canOptimisticallyToggle) {
      setTodos(prev => prev.map(t => t.id === todoId ? { ...t, hidden: newHidden } : t))
    }

    try {
      if (isOwner) {
        await setTaskHidden(todoId, newHidden)

        if (!newHidden) {
          const fullTask = await fetchTaskById(todoId)
          const authorName = friendNameCache.current.get(fullTask.userId)
          const enriched = authorName ? { ...fullTask, authorName, hidden: false } : { ...fullTask, hidden: false }
          setTodos(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
        }
      } else {
        await setViewerPreference(todoId, { hiddenByViewer: newHidden })

        if (!newHidden) {
          const fullTask = await fetchTaskById(todoId)
          const authorName = friendNameCache.current.get(fullTask.userId)
          const enriched = authorName ? { ...fullTask, authorName, hidden: false } : { ...fullTask, hidden: false }
          setTodos(prev => prev.map(t => t.id === todoId ? { ...t, ...enriched } : t))
        }
      }
    } catch {
      if (canOptimisticallyToggle) {
        setTodos(prev => prev.map(t => t.id === todoId ? { ...t, hidden: !newHidden } : t))
      }
      addToast({ type: "error", title: "Failed to update task visibility" })
    }
  }, [addToast, user?.userId])

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const visibleTodos = filterCategoryIds.length === 0
    ? todos
    : todos.filter(t => filterCategoryIds.includes(t.categoryId ?? ""))

  return (
    <div className="space-y-8">
      <div className="rounded-[2rem] border border-gray-200 bg-gradient-to-br from-white via-gray-50 to-gray-100 p-6 md:p-8 shadow-xl">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-6 w-fit text-xs font-bold text-gray-500 hover:text-black"
        >
          <Link href="/tasks">
            <ArrowLeft className="h-4 w-4" />
            Back to tasks
          </Link>
        </Button>

        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Completed Archive
            </p>
            <h1 className="text-3xl font-bold text-gray-900">Completed Tasks</h1>
            <p className="text-gray-500">
              Browse every finished task in one place, newest completions first.
            </p>

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

          <div className="inline-flex items-center gap-3 rounded-[1.5rem] border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black text-white shadow-lg shadow-black/10">
              <History className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Archive</p>
              <p className="text-lg font-black text-gray-900 leading-none">{totalCount}</p>
              <p className="text-xs font-medium text-gray-500 mt-1">Completed tasks</p>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <MasonryColumns
          items={[...Array(PAGE_SIZE)].map((_, i) => ({ id: `completed-skeleton-${i}` }))}
          getKey={(item) => item.id}
          renderItem={() => <TodoSkeleton />}
          columns={4}
          breakpoints={COMPLETED_MASONRY_BREAKPOINTS}
        />
      ) : error ? (
        <div className="rounded-2xl bg-red-50 border border-red-100 p-5 text-sm text-red-700">
          {error}
        </div>
      ) : totalCount === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-[2rem] border border-dashed border-gray-200 bg-white p-16 text-center shadow-sm"
        >
          <div className="mx-auto h-16 w-16 rounded-2xl bg-gray-50 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-8 w-8 text-gray-200" />
          </div>
          <h2 className="text-lg font-black text-gray-900 mb-1">No completed tasks yet</h2>
          <p className="text-sm text-gray-400 font-medium mb-6">
            Finish a task and it will appear here.
          </p>
          <Button asChild>
            <Link href="/tasks">Go to active tasks</Link>
          </Button>
        </motion.div>
      ) : (
        <>
          <MasonryColumns
            items={visibleTodos}
            getKey={(todo) => todo.id}
            getItemWeight={getTaskWeight}
            columns={4}
            breakpoints={COMPLETED_MASONRY_BREAKPOINTS}
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

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCurrentPage((p) => Math.max(1, p - 1))
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }}
                disabled={currentPage === 1}
                className="rounded-xl border-gray-200 font-bold px-4"
              >
                ← Previous
              </Button>

              <div className="flex items-center gap-1">
                {[...Array(totalPages)].map((_, i) => {
                  const pageNum = i + 1
                  if (
                    pageNum === 1 ||
                    pageNum === totalPages ||
                    (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
                  ) {
                    return (
                      <button
                        key={pageNum}
                        onClick={() => {
                          setCurrentPage(pageNum)
                          window.scrollTo({ top: 0, behavior: "smooth" })
                        }}
                        className={cn(
                          "w-8 h-8 rounded-lg text-xs font-bold transition-all",
                          currentPage === pageNum
                            ? "bg-black text-white shadow-lg shadow-black/10 scale-110"
                            : "text-gray-400 hover:bg-gray-100 hover:text-black"
                        )}
                      >
                        {pageNum}
                      </button>
                    )
                  }

                  if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                    return <span key={pageNum} className="text-gray-300">...</span>
                  }

                  return null
                })}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }}
                disabled={currentPage >= totalPages}
                className="rounded-xl border-gray-200 font-bold px-4"
              >
                Next →
              </Button>
            </div>
          )}
        </>
      )}

      {editingTodo && (
        <EditTodoModal
          todo={editingTodo}
          categories={categories}
          onClose={() => setEditingTodo(null)}
          onSave={(payload) => handleUpdate(editingTodo.id, payload)}
          onSaveViewerPreference={(payload) => handleSaveViewerPreference(editingTodo.id, payload.viewerCategoryId)}
          onCreateCategory={fetchCategories}
          onDescriptionChange={(desc) => {
            setTodos((prev) => prev.map(t => t.id === editingTodo.id ? { ...t, description: desc } : t))
            setEditingTodo(prev => prev ? { ...prev, description: desc } : null)
          }}
        />
      )}

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
