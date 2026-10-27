"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  api, fetchTaskById, duplicateTodo, setViewerPreference,
  parseApiResponse, getApiErrorMessage, type ApiResponse,
} from "@/lib/api"
import { useTaskActions } from "@/hooks/use-task-actions"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { Todo, type UpdateTodoPayload, toApiTodoStatus } from "@/types/todo"
import { Category, type CategoryListResponse, toCategoryList } from "@/types/category"
import { TodoEditor } from "@/components/todos/edit-todo-modal"
import { Enter, SkeletonSwap } from "@/components/animated/entrance"
import { MissingTaskScene } from "@/components/errors/scenes"

/**
 * Standalone branch page — the same full task editor the modal shows (title, the inline meta strip
 * with priority / due date / category / visibility, and the branch timeline), on its own URL so it
 * can be opened in a new tab (Ctrl/⌘-click a card, or the modal's "Open page" button). It owns the
 * task + category data and wires every editor action directly against the API.
 */
export default function BranchPage() {
  const params = useParams<{ id: string }>()
  const todoId = params?.id
  const router = useRouter()
  const addToast = useToastStore((s) => s.addToast)
  const viewerId = useAuthStore((s) => s.user?.userId)

  const [todo, setTodo] = useState<Todo | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // Bumped after an action whose system event is materialised asynchronously, so the branch
  // catches it up without a manual refresh.
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    if (!todoId) return
    try {
      const t = await fetchTaskById(todoId)
      setTodo(t)
      setNotFound(false)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [todoId])

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<CategoryListResponse>>("/categories/api/v1/categories")
      setCategories(toCategoryList(parseApiResponse<CategoryListResponse>(res.data)))
    } catch {
      /* categories are optional enrichment — a failure just leaves the picker empty */
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void fetchCategories() }, [fetchCategories])

  // A non-owner's "done" is always their own mark here, and the server's message rides on every
  // failure notice: the editor is the whole page, with no list behind it to explain anything.
  const actions = useTaskActions({ viewerId, completion: { reading: "for-viewer" }, describe: true })
  /** A change to the task on the page; there is nothing to change while there is none. */
  const patchTodo = useCallback((change: (todo: Todo) => Todo) => setTodo((p) => (p ? change(p) : p)), [])

  // ── Editor actions (owner autosave + the branch's task actions) ──
  // Owner autosave: persist the full payload, preserving the current status (the editor payload
  // never carries status — that is driven by the work/complete actions below).
  const handleSave = useCallback(async (payload: UpdateTodoPayload) => {
    if (!todoId || !todo) return
    try {
      const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${todoId}`, {
        ...payload,
        status: toApiTodoStatus(todo.status),
      })
      const updated = parseApiResponse(res.data)
      setTodo((p) => (p ? { ...p, ...updated, authorName: p.authorName ?? updated.authorName } : updated))
    } catch (e) {
      addToast({ type: "error", title: "Couldn't save changes", description: getApiErrorMessage(e, "Couldn't save changes") })
      throw e // surface the editor's autosave error state
    }
  }, [todoId, todo, addToast])

  const handleSaveViewerPreference = useCallback(async ({ viewerCategoryId }: { viewerCategoryId: string | null }) => {
    if (!todoId) return
    try {
      await setViewerPreference(todoId, { viewerCategoryId, updateViewerCategory: true })
      await load()
    } catch (e) {
      addToast({ type: "error", title: "Couldn't save your category", description: getApiErrorMessage(e, "Couldn't save your category") })
      throw e
    }
  }, [todoId, load, addToast])

  // The owner's status change puts the server's task on the page; a worker's join merges into it
  // and a leave reads it again. Either way the branch is caught up on the new system entry.
  const handleStartWork = useCallback(() => actions.startWork(todo, (work) => {
    if (work.via === "status") setTodo(work.updated)
    else setTodo((p) => (p ? work.patch(p) : work.updated))
    setRefreshKey((k) => k + 1)
  }), [todo, actions])

  const handleStopWork = useCallback(() => actions.stopWork(todo, async (work) => {
    if (work.via === "status") setTodo(work.updated)
    else await load()
    setRefreshKey((k) => k + 1)
  }), [todo, actions, load])

  // A viewer may reopen THEIR OWN completion — unless the author has completed the whole task
  // globally, in which case it is closed for everyone and they must duplicate it instead
  // (`useTaskActions`, `for-viewer` reading).
  const handleComplete = useCallback(() => actions.complete(todo, (done) => {
    if (done.via === "viewer") {
      patchTodo(done.patch)
    } else {
      setTodo(done.updated)
      setRefreshKey((k) => k + 1)
    }
  }), [todo, actions, patchTodo])

  const handleDuplicate = useCallback(async () => {
    if (!todo) return
    try {
      const copy = await duplicateTodo(todo.id)
      addToast({ type: "success", title: "Task duplicated", description: "Opening the new copy." })
      router.push(`/branch/${copy.id}`)
    } catch (e) { addToast({ type: "error", title: "Couldn't duplicate task", description: getApiErrorMessage(e, "Couldn't duplicate task") }) }
  }, [todo, router, addToast])

  // The line that says it is loading is only shown if the wait is long enough to notice,
  // and steps aside under the card rather than vanishing (`SkeletonSwap`); the card — the
  // whole page — then arrives as the page's one large surface.
  return (
    <SkeletonSwap
      loading={loading}
      skeleton={<p style={{ fontSize: 14, color: "var(--pl-ink-subtle)", padding: "8px 2px" }}>Loading branch…</p>}
    >
      {notFound || !todo ? (
        <Enter tier="panel">
          <MissingTaskScene />
        </Enter>
      ) : (
        <BranchCard>
          <TodoEditor
            variant="page"
            todo={todo}
            categories={categories}
            onSave={handleSave}
            onSaveViewerPreference={handleSaveViewerPreference}
            onCreateCategory={fetchCategories}
            commentsRefreshKey={refreshKey}
            onLeave={handleStopWork}
            onStartWork={handleStartWork}
            onCompleteTask={handleComplete}
            onDuplicate={handleDuplicate}
            onDescriptionChange={(desc: string) => patchTodo((t) => ({ ...t, description: desc }))}
          />
        </BranchCard>
      )}
    </SkeletonSwap>
  )
}

function BranchCard({ children }: { children: React.ReactNode }) {
  return (
    <Enter
      tier="hero"
      style={{
        // Full-width card matching the page's left/right gutters; the branch flex-fills and
        // scrolls internally so the title/meta stay put.
        display: "flex", flexDirection: "column",
        // The viewport less the droplet bar's room and the column's own air.
        height: "calc(100vh - var(--bar-clearance) - 4rem)", minHeight: 560,
        background: "var(--pl-paper)",
        border: "1px solid var(--pl-line)",
        borderRadius: 24,
        boxShadow: "0 20px 60px -24px rgba(0,0,0,0.18), 0 4px 14px -6px rgba(0,0,0,0.05)",
        overflow: "hidden",
      }}
    >
      {children}
    </Enter>
  )
}
