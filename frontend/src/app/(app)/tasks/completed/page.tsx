"use client"

import Link from "next/link"
import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, History, CalendarSearch, AlertTriangle } from "lucide-react"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"
import { describeError } from "@/lib/errors"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Todo, PagedTodosResponse, type UpdateTodoPayload, isTodoOwner } from "@/types/todo"
import { TodoCard } from "@/components/todos/todo-card"
import { TaskDeletionBadge } from "@/components/todos/task-deletion-badge"
import { MasonryColumns } from "@/components/ui/masonry-columns"
import { TASK_GRID_BREAKPOINTS, TASK_GRID_COLUMNS } from "@/lib/task-grid"
import { useToastStore } from "@/store/toast"
import { Category, type CategoryListResponse, toCategoryList } from "@/types/category"
// Edit modal mounts only when the user clicks a completed task. Lazy-loaded, from the one import
// `useWarmEditor` warms ahead of it (`components/todos/edit-todo-modal/lazy.tsx`).
import { LazyEditTodoModal as EditTodoModal } from "@/components/todos/edit-todo-modal/lazy"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { getTaskWeight } from "@/utils/sort-tasks"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { readFilter, writeFilter, readHintSeen, writeHintSeen } from "@/utils/category-filter"
import { CategoryFilterModal } from "@/components/todos/category-filter-modal"
import { QuickFilterBar } from "@/components/todos/quick-filter-bar"
import { DateFilterPopover } from "@/components/todos/date-filter-popover"
import { formatDueRange } from "@/components/todos/edit-todo-modal/utils"
import { buildCompletionWindow } from "@/utils/completion-window"
import { StatusPanel } from "@/components/ui/status-panel"
import { Pagination } from "@/components/ui/pagination"
import { PageHeader } from "@/components/layout/page-header"
import { Enter, SkeletonSwap } from "@/components/animated/entrance"
import { useListNavigation } from "@/hooks/use-list-navigation"
import { useAuthorNames } from "@/hooks/use-author-names"
import { useTaskActions } from "@/hooks/use-task-actions"
import { useTaskVisibility } from "@/hooks/use-task-visibility"
import { useWarmEditor } from "@/hooks/use-warm-editor"
import { rememberOrigin } from "@/lib/shared-origin"

const PAGE_SIZE = 20

/**
 * When each part of the archive arrives, in ms after the page starts — the way back, the
 * header line by line, the filter, then the cards in reading order (from their moment, or
 * when they load if that is later), and the pager under them.
 */
const COMPLETED_AT = {
  back: 0,
  header: 50,
  filter: 270,
  cards: 350,
  pager: 450,
} as const

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
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [lastFetchedPage, setLastFetchedPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  /** `E` opens the editor with the title already in edit mode; `Enter` and a click do not. */
  const [openInTitleEdit, setOpenInTitleEdit] = useState(false)
  const [deletingTodo, setDeletingTodo] = useState<Todo | null>(null)
  // Category filter — same mechanism + shared persistence as the /tasks page.
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([])
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  // Completion-date search — a single day or an interval ("when was it roughly finished?"). The
  // shape mirrors the estimated-completion date model (DueRange): a lone target day lives in `end`,
  // an interval fills both bounds with `start` ≤ `end`. Empty strings mean "no date filter".
  const [searchStart, setSearchStart] = useState("")
  const [searchEnd, setSearchEnd] = useState("")
  const hasDateFilter = !!(searchStart || searchEnd)
  const [hintDismissed, setHintDismissed] = useState(false)
  const hintDismissedRef = useRef<boolean>(false)
  // Friends' names on the page's tasks, read once per friend (`useAuthorNames`).
  const { enrich: enrichTodosWithAuthorNames, nameOf: authorNameOf } = useAuthorNames(user?.userId)
  // The archive only ever reopens, and every non-owner reopens their own completion.
  const actions = useTaskActions({
    viewerId: user?.userId,
    completion: { direction: "reopen", viewerPreference: "non-owner" },
    log: true,
  })
  // The editor's chunk, fetched before the first open (`useWarmEditor`).
  useWarmEditor()
  const todosRequest = useRef<AbortController | null>(null)
  const requestEpoch = useRef(0)
  const queryRef = useRef({ page: currentPage, start: searchStart, end: searchEnd, userId: user?.userId })
  queryRef.current = { page: currentPage, start: searchStart, end: searchEnd, userId: user?.userId }
  const loadedUserRef = useRef(loadedUserId)
  loadedUserRef.current = loadedUserId
  const loadedCriteria = useRef<{ page: number; start: string; end: string } | null>(null)
  const hasLoadedTodos = loadedUserId !== null && loadedUserId === user?.userId

  // PERF: live mirror for the memoized TodoCard's (possibly stale) handler
  // closures to read from. See the equivalent note on the dashboard.
  const todosRef = useRef(todos)
  todosRef.current = todos

  // ── Category filter (mirrors /tasks: "F" hotkey + chip + per-user persistence) ──
  useEffect(() => {
    const seen = readHintSeen()
    setHintDismissed(seen)
    hintDismissedRef.current = seen
  }, [])

  // Hydrate the persisted filter per-user; re-read when the active user changes so a
  // filter never leaks across accounts while surviving a hard refresh per user.
  useEffect(() => {
    setFilterCategoryIds(readFilter(user?.userId))
  }, [user?.userId])

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
    writeFilter(user?.userId, ids)
  }, [user?.userId])

  // Picking a completion-date window restarts paging at 1 so results aren't stranded on an
  // out-of-range page; the request effect observes the window and page together.
  const handleDateRangeChange = useCallback((start: string | null, end: string | null) => {
    setSearchStart(start ?? "")
    setSearchEnd(end ?? "")
    setCurrentPage(1)
  }, [])

  const clearDateFilter = useCallback(() => {
    setSearchStart("")
    setSearchEnd("")
    setCurrentPage(1)
  }, [])

  const fetchCategories = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await api.get<ApiResponse<CategoryListResponse>>("/categories/api/v1/categories", { signal })
      if (signal?.aborted) return
      setCategories(toCategoryList(parseApiResponse<CategoryListResponse>(res.data)))
    } catch (error) {
      if (signal?.aborted) return
      console.error("Failed to fetch categories:", describeError(error))
    }
  }, [])

  // Read current criteria even when a memoized card retains an older mutation callback.
  const fetchCompletedTodos = useCallback(async (page = queryRef.current.page) => {
    const epoch = ++requestEpoch.current
    todosRequest.current?.abort()
    const controller = new AbortController()
    todosRequest.current = controller
    const { start, end, userId: requestUserId } = queryRef.current
    const isCurrent = () => !controller.signal.aborted && epoch === requestEpoch.current
    setLoading(true)
    setError(null)

    try {
      // Translate the selected day(s) into an inclusive UTC instant window (pure + unit-tested in
      // utils/completion-window): a single pick lives in `searchEnd`, an interval fills both, and the
      // bounds are widened to the user's local day edges so "20 Jun" matches everything finished that
      // day regardless of the stored UTC time-of-day.
      const params: Record<string, string | number | boolean> = {
        pageNumber: page,
        pageSize: PAGE_SIZE,
        isCompleted: true,
        ...buildCompletionWindow(start, end),
      }

      const res = await api.get<PagedTodosResponse>("/todos/api/v1/todos", { params, signal: controller.signal })
      if (!isCurrent()) return

      const items = res.data.items ?? []
      const enriched = await enrichTodosWithAuthorNames(items)
      if (!isCurrent()) return

      setTodos(enriched)
      setTotalCount(res.data.totalCount ?? 0)
      setLastFetchedPage(page)
      loadedCriteria.current = { page, start, end }
      setLoadedUserId(requestUserId ?? null)
    } catch (err) {
      if (!isCurrent()) return
      console.error("Failed to fetch completed todos:", describeError(err))
      const message = err instanceof Error ? err.message : "Failed to load completed tasks"
      const previous = loadedCriteria.current
      // Keep a failed reconciliation's current results, but never label old results
      // with a new page or date window that failed to load.
      if (loadedUserRef.current === requestUserId &&
        previous?.page === page && previous.start === start && previous.end === end) {
        addToast({ type: "error", title: "Couldn't refresh completed tasks", description: message })
      } else {
        setError(message)
      }
    } finally {
      if (isCurrent()) {
        setLoading(false)
        todosRequest.current = null
      }
    }
  }, [enrichTodosWithAuthorNames, addToast])

  useEffect(() => {
    if (!hasHydrated) return

    if (!isAuthenticated || !useAuthStore.getState().isTokenValid()) {
      clearAuth()
      router.replace("/auth/login")
      return
    }

    void fetchCompletedTodos()
    return () => todosRequest.current?.abort()
  }, [isAuthenticated, hasHydrated, router, fetchCompletedTodos, clearAuth, currentPage, searchStart, searchEnd])

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated || !useAuthStore.getState().isTokenValid()) return
    const controller = new AbortController()
    setCategories([])
    void fetchCategories(controller.signal)
    return () => controller.abort()
  }, [hasHydrated, isAuthenticated, user?.userId, fetchCategories])

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

  // A viewer reopens THEIR OWN completion (clears CompletedByViewer); the owner reopens the task
  // globally. Either is refused once the AUTHOR has completed the whole task — then it is closed
  // for everyone and the only path forward is to duplicate it (`useTaskActions`, `reopen` rules).
  const handleComplete = (todoId: string) =>
    actions.complete(todosRef.current.find((t) => t.id === todoId), () => fetchCompletedTodos())

  // The copy is active, so it is not on this page: the notice says where it went.
  const handleDuplicate = (todoId: string) => actions.duplicate(todoId)

  // The archive asks first, so the deletion is sent at once; the archive is read again before the
  // notice.
  const confirmDelete = async () => {
    await actions.remove(deletingTodo, () => fetchCompletedTodos())
    setDeletingTodo(null)
  }

  // Autosave path: keep the modal open and quiet; the in-modal indicator confirms the save, and a
  // failure reaches it.
  const handleUpdate = (todoId: string, payload: UpdateTodoPayload) => actions.save(
    todos.find((t) => t.id === todoId),
    payload,
    (saved, existing) => {
      const authorName = existing.authorName ?? authorNameOf(saved.userId)
      setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...saved, authorName } : t)))
    },
  )

  const handleSaveViewerPreference = useCallback((todoId: string, viewerCategoryId: string | null) => actions.saveViewerCategory(
    todos.find((t) => t.id === todoId),
    viewerCategoryId,
    (fullTask, existing) => {
      const authorName = existing.authorName ?? authorNameOf(fullTask.userId)
      const enriched = authorName ? { ...fullTask, authorName } : fullTask
      setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, ...enriched } : t)))
    },
  ), [todos, actions, authorNameOf])

  // Hiding and opening a task, as every list does it (`useTaskVisibility`).
  const visibility = useTaskVisibility({
    find: (id) => todosRef.current.find(t => t.id === id),
    update: (id, change) => setTodos(prev => prev.map(t => t.id === id ? change(t) : t)),
    viewerId: user?.userId,
    authorName: authorNameOf,
    onError: () => addToast({ type: "error", title: "Couldn't update task visibility" }),
  })
  const handleToggleHidden = visibility.toggle

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const visibleTodos = useMemo(() => filterCategoryIds.length === 0
    ? todos
    : todos.filter(t => filterCategoryIds.includes(t.categoryId ?? "")), [todos, filterCategoryIds])

  // ── The keyboard ───────────────────────────────────────────────────────────
  /*
   * The archive's cards answer the same keys as every other list of cards: `J`/`K` move,
   * Enter opens, `E` opens into the title, Space reopens (the card's own circle does the
   * same), Delete asks first, as the card's own delete does here. Finished cards show no
   * priority, so the number keys pass them by; and there is no bulk action to select for.
   */
  const navIds = useMemo(() => visibleTodos.map(t => t.id), [visibleTodos])
  const openFromKeys = (id: string, titleEdit: boolean) => {
    const todo = todosRef.current.find(t => t.id === id)
    if (!todo) return
    rememberOrigin(nav.getRowNode(id))
    setOpenInTitleEdit(titleEdit)
    setEditingTodo(todo)
  }
  const nav = useListNavigation({
    ids: navIds,
    enabled: !editingTodo && !deletingTodo && !isCategoryModalOpen,
    selection: false,
    onActivate: (id) => openFromKeys(id, false),
    onEdit: (id) => openFromKeys(id, true),
    onToggleComplete: (id) => { void handleComplete(id) },
    onDelete: (id) => {
      const todo = todosRef.current.find(t => t.id === id)
      if (todo && isTodoOwner(todo, user?.userId)) setDeletingTodo(todo)
    },
  })

  return (
    <div className="space-y-8" aria-busy={loading}>
      <div>
        <Enter tier="chip" at={COMPLETED_AT.back} className="-ml-3 mb-4 w-fit">
          <Button asChild variant="ghost" size="sm">
            <Link href="/tasks">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to tasks
            </Link>
          </Button>
        </Enter>
        <PageHeader
          entranceAt={COMPLETED_AT.header}
          // The count waits for the first page rather than arrive reading 0.
          actionsReady={hasLoadedTodos}
          eyebrow="Archive"
          title="Completed tasks"
          description="Everything you have finished, newest first. Restore a task or copy it to start again."
          actions={
            <div className="flex h-9 items-center gap-2 rounded-full border border-line bg-paper px-3.5">
              <History className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              <span className="text-body-sm font-bold tabular-nums text-ink">{totalCount}</span>
              <span className="text-body-sm font-semibold text-ink-muted">completed</span>
            </div>
          }
        />
      </div>

      {/* Quick Filter plate — the applied-filter summary lives inside it (shared with /tasks). The
          completion-date filter is embedded *into* the plate via the dateControl slot: it opens as a
          floating popover, so it never grows the plate or pushes the page down. Shown only when there
          is something to search (any completed task, or a window already applied).

          NOT gated on `!loading`: the bar is a control surface, not results. Gating it on loading
          unmounted it on every refetch — including the one a date pick triggers — which destroyed the
          date popover's open state, so the calendar snapped shut after the first pick instead of
          waiting for the second. Keep the same plate even when categories arrive late or empty. */}
        <Enter tier="panel" at={COMPLETED_AT.filter} className="relative z-30">
          <QuickFilterBar
            categories={categories}
            selectedIds={filterCategoryIds}
            onOpen={() => setIsCategoryModalOpen(true)}
            onClear={() => handleFilterChange([])}
            dateControl={
              totalCount > 0 || hasDateFilter ? (
                <DateFilterPopover
                  start={searchStart}
                  end={searchEnd}
                  onChange={handleDateRangeChange}
                  onClear={clearDateFilter}
                />
              ) : undefined
            }
          />
        </Enter>

      <SkeletonSwap
        loading={!hasLoadedTodos && !error}
        skeleton={
          <MasonryColumns
            items={[...Array(PAGE_SIZE)].map((_, i) => ({ id: `completed-skeleton-${i}` }))}
            getKey={(item) => item.id}
            renderItem={() => <TodoSkeleton completed />}
            columns={TASK_GRID_COLUMNS}
            breakpoints={TASK_GRID_BREAKPOINTS}
          />
        }
      >
        {error ? (
          <Enter tier="panel" at={COMPLETED_AT.cards}>
            <StatusPanel
              tone="alert"
              icon={AlertTriangle}
              title="Couldn't load your completed tasks"
              description={error}
              action={{ label: "Try again", onClick: () => void fetchCompletedTodos() }}
            />
          </Enter>
        ) : totalCount === 0 ? (
          <Enter tier="panel" at={COMPLETED_AT.cards}>
            {hasDateFilter ? (
              <StatusPanel
                icon={CalendarSearch}
                title="No tasks finished in this period"
                description={`Nothing was completed ${formatDueRange(searchStart, searchEnd)}. Try a wider range.`}
                action={{ label: "Clear date filter", onClick: clearDateFilter }}
              />
            ) : (
              <StatusPanel
                icon={CheckCircle2}
                title="No completed tasks yet"
                description="Finish a task and it will appear here."
                action={{ label: "Go to active tasks", href: "/tasks" }}
              />
            )}
          </Enter>
        ) : (
          <>
            <MasonryColumns
              items={visibleTodos}
              getKey={(todo) => todo.id}
              getItemWeight={getTaskWeight}
              columns={TASK_GRID_COLUMNS}
              breakpoints={TASK_GRID_BREAKPOINTS}
              entranceAt={COMPLETED_AT.cards}
              renderItem={(todo) => (
                <div>
                  <TodoCard
                    todo={todo}
                    variant="completed"
                    rowProps={nav.getRowProps(todo.id)}
                    onComplete={() => handleComplete(todo.id)}
                    onDelete={() => setDeletingTodo(todo)}
                    onEdit={() => { setOpenInTitleEdit(false); setEditingTodo(todo) }}
                    onToggleHidden={() => handleToggleHidden(todo.id)}
                  />
                  {/* Gentle auto-deletion countdown. A friend's task completed only by this reader
                      counts from their own completion and leaves only their lists. */}
                  <TaskDeletionBadge
                    completedAt={todo.completedAt}
                    personal={todo.isCompletedByViewer === true && !todo.ownerCompleted}
                    className="mt-2 ml-1"
                  />
                </div>
              )}
            />

          </>
        )}
      </SkeletonSwap>

      {/* Outside the loading branch: the pager stays mounted while the next page loads,
          so the button just pressed keeps keyboard focus instead of unmounting under it. */}
      {!error ? (
        <Pagination
          entranceAt={COMPLETED_AT.pager}
          className="pt-4"
          page={currentPage}
          totalPages={totalPages}
          onChange={(page) => {
            setCurrentPage(Math.min(totalPages, Math.max(1, page)))
            window.scrollTo({ top: 0, behavior: "smooth" })
          }}
        />
      ) : null}

      {editingTodo && (
        <EditTodoModal
          todo={editingTodo}
          categories={categories}
          openInTitleEdit={openInTitleEdit}
          onClose={() => setEditingTodo(null)}
          onSave={(payload) => handleUpdate(editingTodo.id, payload)}
          onSaveViewerPreference={(payload) => handleSaveViewerPreference(editingTodo.id, payload.viewerCategoryId)}
          onCreateCategory={fetchCategories}
          onCompleteTask={isTodoOwner(editingTodo, user?.userId) ? () => handleComplete(editingTodo.id) : undefined}
          onDuplicate={() => handleDuplicate(editingTodo.id)}
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
