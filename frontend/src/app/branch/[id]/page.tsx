"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  api, fetchTaskById, duplicateTodo, joinTodo, leaveTodo, setViewerPreference,
  parseApiResponse, getApiErrorMessage, type ApiResponse,
} from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { Todo, type UpdateTodoPayload, isTodoOwner, toApiTodoStatus } from "@/types/todo"
import { Category, type CategoryListResponse, toCategoryList } from "@/types/category"
import { TodoEditor } from "@/components/todos/edit-todo-modal"

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
      addToast({ type: "error", title: getApiErrorMessage(e, "Failed to save changes") })
      throw e // surface the editor's autosave error state
    }
  }, [todoId, todo, addToast])

  const handleSaveViewerPreference = useCallback(async ({ viewerCategoryId }: { viewerCategoryId: string | null }) => {
    if (!todoId) return
    try {
      await setViewerPreference(todoId, { viewerCategoryId, updateViewerCategory: true })
      await load()
    } catch (e) {
      addToast({ type: "error", title: getApiErrorMessage(e, "Failed to save your category") })
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
    } catch (e) { addToast({ type: "error", title: getApiErrorMessage(e, "Could not update task") }) }
  }, [todo, isOwner, patchStatus, addToast])

  const handleStopWork = useCallback(async () => {
    if (!todo) return
    try {
      if (isOwner) await patchStatus("todo")
      else { await leaveTodo(todo.id); await load(); setRefreshKey((k) => k + 1) }
    } catch (e) { addToast({ type: "error", title: getApiErrorMessage(e, "Could not stop working") }) }
  }, [todo, isOwner, patchStatus, load, addToast])

  const handleComplete = useCallback(async () => {
    if (!todo) return
    const completed = isOwner
      ? (statusKey === "done" || statusKey === "completed")
      : (todo.isCompletedByViewer ?? false)
    // Returning a completed task to work is author-only. A participant can't reopen a shared task —
    // they duplicate it into their own list instead.
    if (completed && !isOwner) {
      addToast({
        type: "warning",
        title: "Only the author can reopen this task",
        description: "Duplicate it to work on your own copy.",
      })
      return
    }
    try {
      if (!isOwner && isShared) {
        const r = await setViewerPreference(todo.id, { completedByViewer: !completed })
        setTodo((p) => (p ? { ...p, isCompletedByViewer: r.completedByViewer ?? false } : p))
      } else {
        await patchStatus(completed ? "todo" : "done")
      }
      addToast({ type: "success", title: completed ? "Task reopened!" : "Task completed!" })
    } catch (e) { addToast({ type: "error", title: getApiErrorMessage(e, "Could not update task") }) }
  }, [todo, isOwner, isShared, statusKey, patchStatus, addToast])

  const handleDuplicate = useCallback(async () => {
    if (!todo) return
    try {
      const copy = await duplicateTodo(todo.id)
      addToast({ type: "success", title: "Task duplicated", description: "Opening the new copy." })
      router.push(`/branch/${copy.id}`)
    } catch (e) { addToast({ type: "error", title: getApiErrorMessage(e, "Could not duplicate task") }) }
  }, [todo, router, addToast])

  if (loading) {
    return <p style={{ fontSize: 13, color: "#a3a3a3", padding: "8px 2px" }}>Loading branch…</p>
  }

  if (notFound || !todo) {
    return (
      <div style={{ padding: "8px 2px" }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: "#0a0a0a", marginBottom: 8 }}>Task not found</p>
        <p style={{ fontSize: 12.5, color: "#737373", marginBottom: 16 }}>
          It may have been deleted, or you don&apos;t have access to it.
        </p>
        <Link href="/tasks" style={{ fontSize: 12, fontWeight: 800, color: "#4f46e5" }}>← Back to tasks</Link>
      </div>
    )
  }

  return (
    <div
      style={{
        // Full-width card matching the page's left/right gutters; the branch flex-fills and
        // scrolls internally so the title/meta stay put.
        display: "flex", flexDirection: "column",
        height: "calc(100vh - 152px)", minHeight: 560,
        background: "white",
        border: "1px solid #f0f0f0",
        borderRadius: 24,
        boxShadow: "0 20px 60px -24px rgba(0,0,0,0.18), 0 4px 14px -6px rgba(0,0,0,0.05)",
        overflow: "hidden",
      }}
    >
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
    </div>
  )
}
