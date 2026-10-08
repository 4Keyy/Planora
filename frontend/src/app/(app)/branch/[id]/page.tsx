"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  api, fetchTaskById, duplicateTodo, joinTodo, leaveTodo, setViewerPreference,
  parseApiResponse, getApiErrorMessage, type ApiResponse,
} from "@/lib/api"
import { isAuthorAlreadyCompletedError, AUTHOR_COMPLETED_TOAST } from "@/lib/errors"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { Todo, type UpdateTodoPayload, isTodoOwner, toApiTodoStatus } from "@/types/todo"
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

  const isOwner = todo ? isTodoOwner(todo, viewerId) : false

  const statusKey = String(todo?.status ?? "").toLowerCase().replace(/\s/g, "")
  const isShared = !!todo && (todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0)

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

  const patchStatus = useRef(async (status: "todo" | "inProgress" | "done") => {
    if (!todoId) return
    const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${todoId}`, { status })
    setTodo(parseApiResponse(res.data))
    setRefreshKey((k) => k + 1)
  }).current

  const handleStartWork = useCallback(async () => {
    if (!todo) return
    try {
      if (isOwner) await patchStatus("inProgress")
      else { const u = await joinTodo(todo.id); setTodo((p) => (p ? { ...p, ...u } : u)); setRefreshKey((k) => k + 1) }
    } catch (e) { addToast({ type: "error", title: "Couldn't update task", description: getApiErrorMessage(e, "Couldn't update task") }) }
  }, [todo, isOwner, patchStatus, addToast])

  const handleStopWork = useCallback(async () => {
    if (!todo) return
    try {
      if (isOwner) await patchStatus("todo")
      else { await leaveTodo(todo.id); await load(); setRefreshKey((k) => k + 1) }
    } catch (e) { addToast({ type: "error", title: "Couldn't stop working", description: getApiErrorMessage(e, "Couldn't stop working") }) }
  }, [todo, isOwner, patchStatus, load, addToast])

  const handleComplete = useCallback(async () => {
    if (!todo) return
    const completed = isOwner
      ? (statusKey === "done" || statusKey === "completed")
      : (todo.isCompletedByViewer ?? false)
    // A viewer may reopen THEIR OWN completion — unless the author has completed the whole task
    // globally, in which case it is closed for everyone and they must duplicate it instead.
    if (completed && !isOwner && todo.ownerCompleted === true) {
      addToast(AUTHOR_COMPLETED_TOAST)
      return
    }
    try {
      if (!isOwner && isShared) {
        const r = await setViewerPreference(todo.id, { completedByViewer: !completed })
        setTodo((p) => (p ? { ...p, isCompletedByViewer: r.completedByViewer ?? false, ownerCompleted: r.ownerCompleted } : p))
      } else {
        await patchStatus(completed ? "todo" : "done")
      }
      addToast({ type: "success", title: completed ? "Task reopened" : "Task completed" })
    } catch (e) {
      if (isAuthorAlreadyCompletedError(e)) {
        addToast(AUTHOR_COMPLETED_TOAST)
      } else {
        addToast({ type: "error", title: "Couldn't update task", description: getApiErrorMessage(e, "Couldn't update task") })
      }
    }
  }, [todo, isOwner, isShared, statusKey, patchStatus, addToast])

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
            onDescriptionChange={(desc: string) => setTodo((p) => (p ? { ...p, description: desc } : p))}
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
