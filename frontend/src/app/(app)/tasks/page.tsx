"use client"

import Link from "next/link"
import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import { useCollapseScroll } from "@/hooks/use-collapse-scroll"
import { useRouter } from "next/navigation"
import { AnimatePresence } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { CheckCircle2, ChevronRight, History, FolderOpen, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import axios from "axios"
import { api, fetchTaskById, parseApiResponse, type ApiResponse } from "@/lib/api"
import { ensureFriendNames } from "@/lib/friend-names"
import { describeError } from "@/lib/errors"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Todo, PagedTodosResponse, type CreateTodoPayload, type UpdateTodoPayload, isCompletedTodoStatus, isTodoOwner, sameUserId } from "@/types/todo"
import { TodoCard } from "@/components/todos/todo-card"
import { MasonryColumns } from "@/components/ui/masonry-columns"
import { TASK_GRID_BREAKPOINTS, TASK_GRID_COLUMNS } from "@/lib/task-grid"
import { CreatePlatePlaceholder } from "@/components/todos/plate-placeholder"
import { useToastStore } from "@/store/toast"
import { Category, type CategoryListResponse, toCategoryList } from "@/types/category"
import dynamic from "next/dynamic"
// Heavy task-editing components are lazy-loaded: they only mount when the user
// opens the create panel or clicks edit on a card, so deferring their JS
// shrinks the tasks page's First Load by ~30 kB without changing the visible
// flow (the framer-motion enter animation absorbs the ~50 ms chunk fetch).
import { LazyEditTodoModal as EditTodoModal } from "@/components/todos/edit-todo-modal/lazy"
const CreateTodoPanel = dynamic(
  () => import("@/components/todos/create-todo-panel").then((m) => ({ default: m.CreateTodoPanel })),
  {
    ssr: false,
    // The panel's collapsed header is now always on screen (it IS the "new task"
    // affordance), so reserve its footprint while the chunk streams in to avoid
    // a layout pop.
    loading: () => <CreatePlatePlaceholder />,
  },
)
import { sortTasks, getTaskWeight } from "@/utils/sort-tasks"
import { putBack } from "@/utils/todo-utils"
import { useFeedSync, useRealtimeResync } from "@/lib/realtime/hooks"
import { DURATION_FAST, DURATION_UI, EASE_EXIT, EASE_OUT_EXPO, SPRING_STANDARD } from "@/lib/animations"
import { readFilter, writeFilter } from "@/utils/category-filter"
import { CategoryFilterModal } from "@/components/todos/category-filter-modal"
import { QuickFilterBar } from "@/components/todos/quick-filter-bar"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { Enter, SkeletonSwap } from "@/components/animated/entrance"
import { StatusPanel } from "@/components/ui/status-panel"
import { FIELD_LABEL_CLASS } from "@/components/ui/field-label"
import { PageHeader } from "@/components/layout/page-header"
import { NumberRoll } from "@/components/ui/number-roll"
import { UndoBar, useUndoableAction } from "@/components/ui/undo-bar"
import { useListNavigation } from "@/hooks/use-list-navigation"
import { usePriorityWriter } from "@/hooks/use-priority-writer"
import { useTaskActions } from "@/hooks/use-task-actions"
import { useTaskVisibility } from "@/hooks/use-task-visibility"
import { useWarmEditor } from "@/hooks/use-warm-editor"
import { rememberOrigin } from "@/lib/shared-origin"
import { SelectionBar } from "@/components/ui/selection-bar"
import { useNewTaskShortcut } from "@/hooks/use-new-task-shortcut"
import { UpdatePill, useDeferredUpdates } from "@/components/ui/update-pill"

// The server never returns more than 100 rows a page (PaginationParameters.MaxPageSize) and
// silently clamps larger requests, so asking for more only hid every task after the first
// hundred: the loop below took the short page for the last one.
const ACTIVE_PAGE_SIZE = 100
/** Pages read before giving up — 10 000 active tasks, far beyond any real list. */
const ACTIVE_PAGE_LIMIT = 100
/** Queued with friends' task ids when the live feed may have missed some: re-read the whole list. */
const RESYNC_ALL = "*"
const COMPLETED_PREVIEW_SIZE = 20
// PERF: the active feed keeps the "all tasks in one scroll" UX, but only mounts
// a window of cards into the DOM. TodoCard is expensive, so mounting hundreds at
// once is what made this page lag. We render an initial batch and grow it as the
// user scrolls (IntersectionObserver sentinel), capping mounted cards regardless
// of how many tasks exist. Data is still fetched in full so client-side category
// filtering stays instant.
const INITIAL_VISIBLE_TASKS = 24
const VISIBLE_TASKS_CHUNK = 24
const EMPTY_USER_ID = "00000000-0000-0000-0000-000000000000"

/**
 * When each part of the page arrives, in ms after it starts — top to bottom: the header
 * line by line, the New task plate, the filter, then the cards in reading order (from their
 * moment, or the moment they load if that is later), and the Completed row after them.
 */
const TASKS_AT = {
  header: 0,
  newTask: 190,
  filter: 260,
  cards: 340,
  completed: 440,
} as const

/**
 * Header count pill ("5 active" / "2 done"). The number crossfades vertically
 * on change so live updates read as a counter roll, never a hard swap.
 */
function StatusPill({ count, label, emphasis }: { count: number; label: string; emphasis?: boolean }) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-full border border-line bg-paper px-3.5">
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", emphasis ? "bg-ink" : "bg-line-strong")} />
      {/* Was a single column that swapped the whole number; now every digit rolls on
          its own, so 9 → 10 grows a column instead of replacing a glyph.

          `minDigits={2}` is a layout guarantee, not padding. These pills start at
          `0` while the list loads and settle on a real count, and on a 390px screen
          that one extra digit was enough to push this header past its wrap point:
          the title row went to two lines and everything below it jumped 54px —
          0.119 CLS, the worst cell in the matrix. Layout is decided by the
          viewport; it is never allowed to be decided by the data. Centred in that
          room, so a single digit sits evenly between the dot and its word instead of
          leaving a hole on one side. */}
      <NumberRoll
        value={count}
        minDigits={2}
        align="center"
        className={cn("text-body-sm font-bold", emphasis ? "text-ink" : "text-ink-muted")}
      />
      <span className={cn("text-body-sm font-semibold", emphasis ? "text-ink" : "text-ink-muted")}>{label}</span>
    </div>
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
  /** Each list has been read once: the header's counts may arrive, already right. */
  const [activeLoaded, setActiveLoaded] = useState(false)
  const [completedLoaded, setCompletedLoaded] = useState(false)
  const [completedLoading, setCompletedLoading] = useState(false)

  const friendNameCache = useRef<Map<string, string>>(new Map())

  // PERF: live mirrors of the lists for the memoized TodoCard's (possibly stale)
  // handler closures to read from. See the equivalent note on the dashboard.
  const todosRef = useRef(todos)
  const completedPreviewRef = useRef(completedPreview)
  todosRef.current = todos
  completedPreviewRef.current = completedPreview

  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  /** `E` opens the editor with the title already in edit mode; `Enter` does not. */
  const [openInTitleEdit, setOpenInTitleEdit] = useState(false)
  /** Deletions wait five seconds in here instead of behind a confirmation dialog. */
  const undoable = useUndoableAction()
  const actions = useTaskActions({
    viewerId: user?.userId,
    log: true,
    work: { joinFailed: "Couldn't join task", explainFull: true, leaveFailed: "Couldn't leave task" },
  })
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([])
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)

  /**
   * Whether the list itself has the screen.
   *
   * One flag for the list consumers, because they are asking the same question and
   * must not be able to answer it differently: the keyboard detaches and
   * realtime updates queue instead of landing under a dialog the
   * user is reading.
   */
  const listKeysEnabled = !editingTodo && !isCreateOpen && !isCategoryModalOpen
  const { panelRef: createPanelRef, titleRequest } = useNewTaskShortcut({
    // The open composer suspends list keys, but C may still request its title again.
    enabled: isAuthenticated && (listKeysEnabled || isCreateOpen) && !editingTodo && !isCategoryModalOpen,
    onOpen: () => setIsCreateOpen(true),
  })

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
  // always on screen, so the shortcut works whether or not the create panel is expanded —
  // except while the panel is OPEN: then a printable key belongs to its title (type-to-focus in
  // create-todo-panel.tsx), and "Fix the sink" must not open the filter on its first letter.
  // This capture listener is registered before the panel's, so it has to step aside itself.
  useEffect(() => {
    if (isCreateOpen) return
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
  }, [isCreateOpen])


  // The editor's chunk, fetched before the first open (`useWarmEditor`).
  useWarmEditor()

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
      console.error("Failed to fetch categories:", describeError(error))
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
      // Keyed by id: a task created or re-sorted while the pages are being read can shift
      // across a page boundary and arrive twice. The first copy keeps its place.
      const byId = new Map<string, Todo>()
      let page = 1

      while (page <= ACTIVE_PAGE_LIMIT) {
        if (signal?.aborted) return
        const res = await api.get<PagedTodosResponse>("/todos/api/v1/todos", {
          params: { pageNumber: page, pageSize: ACTIVE_PAGE_SIZE, isCompleted: false },
          signal,
        })
        const items = res.data.items ?? []
        for (const item of items) {
          if (!byId.has(item.id)) byId.set(item.id, item)
        }

        // The last page is the one the server says is last; failing that, one that reaches
        // the total, or one shorter than the page size the server actually used.
        if (items.length === 0) break
        if (res.data.hasNextPage === false) break
        if (typeof res.data.totalCount === "number" && byId.size >= res.data.totalCount) break
        if (items.length < (res.data.pageSize ?? ACTIVE_PAGE_SIZE)) break
        page += 1
      }
      const all = [...byId.values()]

      if (signal?.aborted) return
      const enriched = await enrichTodosWithAuthorNames(all)
      if (signal?.aborted) return
      setTodos(enriched)
    } catch (error) {
      if (axios.isCancel(error) || signal?.aborted) return
      console.error("Failed to fetch active todos:", describeError(error))
      // A silent background reconcile must not surface a toast — the cards already
      // on screen stay valid; only an interactive (non-silent) load reports failure.
      if (!silent) addToast({ type: "error", title: "Couldn't load tasks" })
    } finally {
      if (!silent && !signal?.aborted) setLoading(false)
      if (!signal?.aborted) setActiveLoaded(true)
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
      console.error("Failed to fetch completed preview:", describeError(error))
      setCompletedPreview([])
      setCompletedTotalCount(0)
    } finally {
      if (!signal?.aborted) {
        setCompletedLoading(false)
        setCompletedLoaded(true)
      }
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
      const ids = new Set(taskIds)
      // A resync covers every queued task: the whole list is read again.
      if (ids.has(RESYNC_ALL)) {
        void fetchActiveTodos({ silent: true })
        void fetchCompletedPreview()
        return
      }
      for (const id of ids) void reconcileTaskById(id)
    }, [reconcileTaskById, fetchActiveTodos, fetchCompletedPreview]),
  })

  // Signals missed while the socket was down are not replayed. When it comes back (and every 30 s
  // while it stays down) the whole list is read again — through the same queue as a friend's edit,
  // so it applies at once at the top of an idle list and otherwise waits behind the pill.
  useRealtimeResync(useCallback(() => {
    if (incoming.pending.includes(RESYNC_ALL)) return
    incoming.push(RESYNC_ALL)
  }, [incoming]))

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

  /*
   * What the press sends and says is `useTaskActions`'s. Here: a completed card leaves the active
   * list and the Completed row is read again; a reopened one has both lists read again.
   */
  const handleComplete = async (id: string) => {
    const existingTodo = todosRef.current.find((t) => t.id === id) ?? completedPreviewRef.current.find((t) => t.id === id)
    await actions.complete(existingTodo, async (done) => {
      if (done.via === "viewer") setTodos((prev) => prev.map((t) => (t.id !== id ? t : done.patch(t))))
      if (done.reopened) {
        await Promise.all([fetchActiveTodos({ silent: true }), fetchCompletedPreview()])
      } else {
        setTodos((prev) => prev.filter((t) => t.id !== id))
        await fetchCompletedPreview()
      }
    })
  }

  // The notice waits for the active list to show the copy.
  const handleDuplicate = (id: string) => actions.duplicate(id, () => fetchActiveTodos({ silent: true }))

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

    // A completed card stays in the Completed row until the server has deleted it; the row is
    // then read again.
    actions.removeWithUndo(todo, undoable.run, {
      take: () => { if (!wasCompleted) setTodos((prev) => prev.filter((t) => t.id !== todo.id)) },
      restore: () => { if (!wasCompleted) setTodos((prev) => putBack(prev, todo, index)) },
      after: async () => { if (wasCompleted) await fetchCompletedPreview() },
    })
  }

  /** A saved task replaces its card in whichever list holds it. */
  const replaceInItsList = (existingTodo: Todo, nextTodo: Todo) => {
    const replace = (prev: Todo[]) => prev.map((t) => (t.id === existingTodo.id ? nextTodo : t))
    if (isCompletedTodoStatus(existingTodo.status)) setCompletedPreview(replace)
    else setTodos(replace)
  }

  // Autosave path: keep the modal open and stay quiet — the in-modal AutosaveIndicator reports
  // success, and a failure reaches it to retry on the next edit. We intentionally do not refresh
  // `editingTodo` so the open modal's local field state (the source of truth while editing) is
  // never clobbered mid-edit.
  const handleUpdate = (id: string, payload: UpdateTodoPayload) => actions.save(
    todos.find((t) => t.id === id) ?? completedPreview.find((t) => t.id === id),
    payload,
    (saved, existingTodo) => {
      const authorName = existingTodo.authorName ?? friendNameCache.current.get(saved.userId)
      replaceInItsList(existingTodo, { ...saved, authorName })
    },
  )

  const handleSaveViewerPreference = (id: string, viewerCategoryId: string | null) => actions.saveViewerCategory(
    todos.find((t) => t.id === id) ?? completedPreview.find((t) => t.id === id),
    viewerCategoryId,
    (fullTask, existingTodo) => {
      const authorName = existingTodo.authorName ?? friendNameCache.current.get(fullTask.userId)
      replaceInItsList(existingTodo, authorName ? { ...fullTask, authorName } : fullTask)
    },
  )

  const handleCreate = async (payload: CreateTodoPayload) => {
    try {
      const res = await api.post<ApiResponse<Todo>>("/todos/api/v1/todos", payload)
      setIsCreateOpen(false)
      addToast({ type: "success", title: "Task created" })
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
      console.error("Failed to create todo:", describeError(error))
      addToast({ type: "error", title: "Couldn't create task" })
    }
  }

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

    // Ascending, so each insertion index is still valid once the earlier ones have been put back.
    const putBackAll = (entries: { index: number; todo: Todo }[]) => (prev: Todo[]) =>
      entries.reduce((list, { index, todo }) => putBack(list, todo, index), prev)
    const restore = () => setTodos(putBackAll(removed))

    undoable.run({
      label: removed.length === 1
        ? "Task deleted"
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
            ? "Couldn't delete tasks"
            : "Couldn't delete some tasks",
          description: `${failed.length} of ${removed.length} tasks could not be deleted.`,
        })
        setTodos(putBackAll(failed))
      },
      rollback: restore,
    })
  }, [undoable, addToast])

  /*
   * Hiding a card and opening it again (`useTaskVisibility`), as every list does it. Opening
   * waits for the task's content, fetched ahead while the pointer rests on the card, so the
   * card opens once with everything in it — and keeps its place in the list. A task hidden by
   * its viewer drops its details here as the server will on the next load.
   */
  const visibility = useTaskVisibility({
    find: (id) => todosRef.current.find(t => t.id === id) ?? completedPreviewRef.current.find(t => t.id === id),
    update: (id, change) => {
      const apply = (prev: Todo[]) => prev.map(t => t.id === id ? change(t) : t)
      setTodos(apply)
      setCompletedPreview(apply)
    },
    viewerId: user?.userId,
    authorName: (userId) => friendNameCache.current.get(userId),
    onError: () => addToast({ type: "error", title: "Couldn't update task visibility" }),
    redactViewerHidden: redactHiddenSharedTodo,
  })
  const handleToggleHidden = visibility.toggle

  const activeCount = todos.filter(t => t.isCompletedByViewer !== true).length
  const doneCount = completedTotalCount
  const totalCount = activeCount + doneCount
  const countsKnown = activeLoaded && completedLoaded

  const sortedTodos = useMemo(() => {
    const filtered = todos.filter(t => t.isCompletedByViewer !== true)
    return sortTasks(filtered, user?.userId)
  }, [todos, user?.userId])

  const sortedCompletedPreview = useMemo(() => sortTasks(completedPreview, user?.userId), [completedPreview, user?.userId])
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

  const writePriority = usePriorityWriter({
    read: (id) => todosRef.current.find((t) => t.id === id) ?? completedPreviewRef.current.find((t) => t.id === id),
    patch: (id, fields) => {
      const merge = (prev: Todo[]) => prev.map((t) => (t.id === id ? { ...t, ...fields } : t))
      setTodos(merge)
      setCompletedPreview(merge)
    },
    save: async (id, level) => {
      const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${id}`, { priority: level })
      return parseApiResponse(res.data)
    },
    onError: () => addToast({ type: "error", title: "Couldn't change the priority" }),
  })

  /**
   * `1`–`5`, from the cursor or the pointer. Only the owner may re-prioritise — a shared
   * viewer pressing `3` would earn a 403 for a key nobody offered them — and never on a
   * hidden card, whose copy is the server's redacted one.
   */
  const handlePriority = (id: string, level: number) => {
    const todo = todosRef.current.find((t) => t.id === id)
    if (!todo || todo.hidden || !isTodoOwner(todo, user?.userId)) return
    writePriority(id, level)
  }

  /**
   * Enter and `E` on a hidden card open the card, as a press on it does — never the
   * editor. The editor would be seeded with the redacted copy (no description, no date,
   * no audience), and its first autosave would have written exactly that back.
   */
  const openFromKeys = (id: string, titleEdit: boolean) => {
    const todo = todosRef.current.find((t) => t.id === id)
    if (!todo) return
    if (todo.hidden) {
      void handleToggleHidden(id)
      return
    }
    // Hand over the same rect a click would have, so Enter and a pointer open
    // the editor identically. See lib/shared-origin.ts.
    rememberOrigin(nav.getRowNode(id))
    // `E` is the only path that lands in the title. The keyboard map promises
    // "Edit it in place", and until now it opened exactly what Enter opened.
    setOpenInTitleEdit(titleEdit)
    setEditingTodo(todo)
  }

  const nav = useListNavigation({
    ids: navIds,
    enabled: listKeysEnabled,
    onActivate: (id) => openFromKeys(id, false),
    onEdit: (id) => openFromKeys(id, true),
    onToggleComplete: (id) => { void handleComplete(id) },
    onDelete: (id) => {
      const todo = todosRef.current.find((t) => t.id === id)
      // Only the owner can delete; anyone else's Delete would be put back by the server
      // five seconds later, with an error.
      if (todo && isTodoOwner(todo, user?.userId)) requestDelete(todo)
    },
    onPriority: handlePriority,
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
      <PageHeader
        entranceAt={TASKS_AT.header}
        eyebrow="Workspace"
        title="Tasks"
        // The counts wait for both lists rather than arrive reading 0 and roll up. Keyed by
        // that, so a pill arrives with its number instead of rolling to it as it appears.
        actionsReady={countsKnown}
        actions={
          <>
            <StatusPill key={countsKnown ? "active" : "active-loading"} count={activeCount} label="active" emphasis />
            <StatusPill key={countsKnown ? "done" : "done-loading"} count={doneCount} label="done" />
          </>
        }
      />

      {/* The redesigned control deck: the create panel and the quick-filter plate are BOTH always
          on screen — the panel's own collapsed header is the "new task" affordance and expands in
          place. Create sits above the filter (task creation is the primary action of this page). */}
      <Enter ref={createPanelRef} tier="panel" at={TASKS_AT.newTask}>
        <CreateTodoPanel
          isOpen={isCreateOpen}
          titleRequest={titleRequest}
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
      </Enter>
      <Enter tier="panel" at={TASKS_AT.filter}>
        <QuickFilterBar
          categories={categories}
          selectedIds={filterCategoryIds}
          onOpen={() => setIsCategoryModalOpen(true)}
          onClear={() => handleFilterChange([])}
        />
      </Enter>

      <SkeletonSwap
        loading={loading}
        skeleton={
          <MasonryColumns
            items={[...Array(6)].map((_, i) => ({ id: `skeleton-${i}` }))}
            getKey={(item) => item.id}
            renderItem={() => <TodoSkeleton />}
            columns={TASK_GRID_COLUMNS}
            breakpoints={TASK_GRID_BREAKPOINTS}
          />
        }
      >
        {totalCount === 0 ? (
          <Enter tier="panel" at={TASKS_AT.cards}>
            <StatusPanel
              icon={CheckCircle2}
              title="No tasks yet"
              description="Write down the first thing on your mind. You can share it later."
              action={{ label: "Create a task", onClick: () => setIsCreateOpen(true) }}
            />
          </Enter>
        ) : (
          <div className="space-y-10">
            <div>
              {visibleTodos.length === 0 ? (
                <Enter tier="panel" at={TASKS_AT.cards}>
                  {filterCategoryIds.length > 0 ? (
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
                  )}
                </Enter>
              ) : (
                <>
                {/* Held realtime changes, offered above the list they would have
                    moved. Renders nothing while the queue is empty. */}
                <UpdatePill count={incoming.count} onShow={incoming.show} noun="update" />
                <MasonryColumns
                  items={renderedTodos}
                  getKey={(todo) => todo.id}
                  getItemWeight={getTaskWeight}
                  columns={TASK_GRID_COLUMNS}
                  breakpoints={TASK_GRID_BREAKPOINTS}
                  entranceAt={TASKS_AT.cards}
                  renderItem={(todo) => (
                    <TodoCard
                      todo={todo}
                      variant="default"
                      rowProps={nav.getRowProps(todo.id)}
                      onComplete={() => handleComplete(todo.id)}
                      onDelete={() => requestDelete(todo)}
                      onEdit={() => { setOpenInTitleEdit(false); setEditingTodo(todo) }}
                      onToggleHidden={() => handleToggleHidden(todo.id)}
                      onRevealIntent={() => visibility.prefetch(todo.id)}
                      visibilityPending={visibility.isPending(todo.id)}
                      onPriority={(level) => handlePriority(todo.id, level)}
                      // A join turned down as full reads the task again, so the card shows who is on it.
                      onJoin={() => actions.startWork(todo, (work) => {
                        setTodos((prev) => prev.map((t) => t.id === todo.id ? work.patch(t) : t))
                        setCommentsRefreshKey((k) => k + 1)
                      }, {
                        onFull: (fresh) => setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, ...fresh } : t)),
                      })}
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
              <Enter tier="row" at={TASKS_AT.completed} className="space-y-4">
                <button
                  type="button"
                  onClick={() => setShowCompleted((prev) => !prev)}
                  aria-expanded={showCompleted}
                  className="group flex min-h-control w-full items-center gap-3 text-left"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-fast",
                      showCompleted ? "bg-ink text-paper" : "bg-paper-sunken text-ink-muted group-hover:text-ink",
                    )}
                  >
                    <motion.span
                      className="flex"
                      animate={{ rotate: showCompleted ? 90 : 0 }}
                      transition={SPRING_STANDARD}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </motion.span>
                  </span>
                  <span className="text-title-sm font-bold tracking-tight text-ink">Completed</span>
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-paper-sunken px-2 text-caption font-semibold tabular-nums text-ink-muted ring-1 ring-inset ring-line">
                    {completedTotalCount}
                  </span>
                  <span aria-hidden="true" className="h-px flex-1 bg-line" />
                </button>
                {/* Opacity and a short rise, not `height: auto`: animating height re-laid out
                    every card below the toggle on every frame of the opening. */}
                <AnimatePresence initial={false}>
                  {showCompleted && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, transition: { duration: DURATION_FAST, ease: EASE_EXIT } }}
                      transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}
                    >
                      <div className="space-y-4">
                        {completedLoading && completedPreview.length === 0 ? (
                          <MasonryColumns
                            items={[...Array(Math.min(3, COMPLETED_PREVIEW_SIZE))].map((_, i) => ({ id: `completed-skeleton-${i}` }))}
                            getKey={(item) => item.id}
                            renderItem={() => <TodoSkeleton completed />}
                            columns={TASK_GRID_COLUMNS}
                            breakpoints={TASK_GRID_BREAKPOINTS}
                          />
                        ) : (
                          <>
                            <MasonryColumns
                              items={sortedCompletedPreview}
                              getKey={(todo) => todo.id}
                              getItemWeight={getTaskWeight}
                              columns={TASK_GRID_COLUMNS}
                              breakpoints={TASK_GRID_BREAKPOINTS}
                              renderItem={(todo) => (
                                <TodoCard
                                  todo={todo}
                                  variant="completed"
                                  onComplete={() => handleComplete(todo.id)}
                                  onDelete={() => requestDelete(todo)}
                                  onEdit={() => { setOpenInTitleEdit(false); setEditingTodo(todo) }}
                                  onToggleHidden={() => handleToggleHidden(todo.id)}
                                />
                              )}
                            />
                            <div className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-5 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className={FIELD_LABEL_CLASS}>
                                  {completedTotalCount > COMPLETED_PREVIEW_SIZE
                                    ? `Showing the latest ${COMPLETED_PREVIEW_SIZE}`
                                    : "Everything you have finished"}
                                </p>
                                <p className="mt-1 text-body-sm text-ink-muted">
                                  {completedTotalCount > COMPLETED_PREVIEW_SIZE
                                    ? `The archive has all ${completedTotalCount} completed tasks.`
                                    : "All of your completed tasks fit here. The archive can restore or copy any of them."}
                                </p>
                              </div>
                              <Button asChild variant="outline" className="flex-shrink-0">
                                <Link href="/tasks/completed">
                                  <History className="h-4 w-4" aria-hidden="true" />
                                  Open the archive
                                </Link>
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Enter>
            )}
          </div>
        )}
      </SkeletonSwap>

      <AnimatePresence>
        {editingTodo && (
          <EditTodoModal
            openInTitleEdit={openInTitleEdit}
            todo={editingTodo}
            categories={categories}
            onClose={() => setEditingTodo(null)}
            onSave={(payload) => handleUpdate(editingTodo.id, payload)}
            onSaveViewerPreference={(payload) => handleSaveViewerPreference(editingTodo.id, payload.viewerCategoryId)}
            onCreateCategory={fetchCategories}
            commentsRefreshKey={commentsRefreshKey}
            onStartWork={() => actions.startWork(editingTodo, (work) => {
              setTodos((prev) => prev.map((t) => t.id === work.todo.id ? work.patch(t) : t))
              setEditingTodo((prev) => prev ? work.patch(prev) : prev)
              setCommentsRefreshKey((k) => k + 1)
            })}
            onCompleteTask={() => handleComplete(editingTodo.id)}
            onDuplicate={() => handleDuplicate(editingTodo.id)}
            onDescriptionChange={(desc) => {
              const update = (prev: Todo[]) => prev.map(t => t.id === editingTodo.id ? { ...t, description: desc } : t)
              setTodos(update)
              setCompletedPreview(update)
              setEditingTodo(prev => prev ? { ...prev, description: desc } : null)
            }}
            onLeave={() => actions.stopWork(editingTodo, (work) => {
              setTodos((prev) => prev.map((t) => t.id === work.todo.id ? work.patch(t) : t))
              setCommentsRefreshKey((k) => k + 1)
            })}
          />
        )}
      </AnimatePresence>

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

      <UndoBar pending={undoable.pending} onUndo={undoable.undo} onHold={undoable.hold} onRelease={undoable.release} onDismiss={undoable.settle} />

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
