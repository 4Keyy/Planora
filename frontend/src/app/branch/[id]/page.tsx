"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { api, fetchTaskById, duplicateTodo, joinTodo, leaveTodo, setViewerPreference, parseApiResponse, getApiErrorMessage, type ApiResponse } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { Todo, isTodoOwner } from "@/types/todo"
import { BranchFeed } from "@/components/todos/edit-todo-modal/branch-feed"

/**
 * Standalone branch page — the same task timeline ("ветка") the modal shows, on its own URL so it
 * can be opened in a new tab (Ctrl/Cmd-click a card, or the modal's "Open page" button). Reuses
 * BranchFeed and wires the same task actions directly against the API.
 */
export default function BranchPage() {
  const params = useParams<{ id: string }>()
  const todoId = params?.id
  const router = useRouter()
  const addToast = useToastStore((s) => s.addToast)
  const viewerId = useAuthStore((s) => s.user?.userId)

  const [todo, setTodo] = useState<Todo | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [pillHovered, setPillHovered] = useState(false)
  // Optimistic in-progress flag so the pill flips instantly before the refetch lands.
  const [workOverride, setWorkOverride] = useState<boolean | null>(null)
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

  useEffect(() => { void load() }, [load])
  useEffect(() => { setWorkOverride(null) }, [todoId])

  const isOwner = todo ? isTodoOwner(todo, viewerId) : false

  const statusKey = String(todo?.status ?? "").toLowerCase().replace(/\s/g, "")
  const ownerInProgress = statusKey === "inprogress"
  const baseInProgress = isOwner ? ownerInProgress : (todo?.isWorking ?? false)
  const inProgress = workOverride ?? baseInProgress
  const isCompleted = isOwner
    ? (statusKey === "done" || statusKey === "completed")
    : (todo?.isCompletedByViewer ?? false)
  const isShared = !!todo && (todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0)

  // ── Action handlers (mirror the modal's, calling the API directly) ──
  const patchStatus = useRef(async (status: "todo" | "inProgress" | "done") => {
    if (!todoId) return
    const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${todoId}`, { status })
    setTodo(parseApiResponse(res.data))
    setRefreshKey((k) => k + 1)
  }).current

  const handleSaveDescription = async (text: string) => {
    if (!todoId) return
    const res = await api.put<ApiResponse<Todo>>(`/todos/api/v1/todos/${todoId}`, { description: text.trim() || null })
    setTodo(parseApiResponse(res.data))
  }

  const handleStartWork = async () => {
    if (!todo) return
    setWorkOverride(true)
    try {
      if (isOwner) await patchStatus("inProgress")
      else { const u = await joinTodo(todo.id); setTodo((p) => p ? { ...p, ...u } : u); setRefreshKey((k) => k + 1) }
    } catch (e) { setWorkOverride(null); addToast({ type: "error", title: getApiErrorMessage(e, "Could not update task") }) }
  }

  const handleStopWork = async () => {
    if (!todo) return
    setWorkOverride(false)
    try {
      if (isOwner) await patchStatus("todo")
      else { await leaveTodo(todo.id); await load(); setRefreshKey((k) => k + 1) }
    } catch (e) { setWorkOverride(null); addToast({ type: "error", title: getApiErrorMessage(e, "Could not stop working") }) }
  }

  const handleComplete = async () => {
    if (!todo) return
    try {
      if (!isOwner && isShared) {
        const wasCompleted = todo.isCompletedByViewer === true
        const r = await setViewerPreference(todo.id, { completedByViewer: !wasCompleted })
        setTodo((p) => p ? { ...p, isCompletedByViewer: r.completedByViewer ?? false } : p)
        addToast({ type: "success", title: wasCompleted ? "Task reopened!" : "Task completed!" })
        return
      }
      await patchStatus(isCompleted ? "todo" : "done")
      addToast({ type: "success", title: isCompleted ? "Task reopened!" : "Task completed!" })
    } catch (e) { addToast({ type: "error", title: getApiErrorMessage(e, "Could not update task") }) }
  }

  const handleDuplicate = async () => {
    if (!todo) return
    try {
      const copy = await duplicateTodo(todo.id)
      addToast({ type: "success", title: "Task duplicated", description: "Opening the new copy." })
      router.push(`/branch/${copy.id}`)
    } catch (e) { addToast({ type: "error", title: getApiErrorMessage(e, "Could not duplicate task") }) }
  }

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
        display: "flex", flexDirection: "column",
        height: "calc(100vh - 140px)", minHeight: 520,
        background: "white",
        border: "1px solid #f0f0f0",
        borderRadius: 24,
        boxShadow: "0 20px 60px -24px rgba(0,0,0,0.18), 0 4px 14px -6px rgba(0,0,0,0.05)",
        overflow: "hidden",
      }}
    >
      {/* ── Top chrome ── */}
      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Link
          href="/tasks"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "#a3a3a3", textDecoration: "none",
          }}
        >
          <ArrowLeft size={13} strokeWidth={2.4} /> Task Branch
        </Link>

        {inProgress && (
          <div
            onMouseEnter={() => setPillHovered(true)}
            onMouseLeave={() => setPillHovered(false)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: pillHovered ? "#fef2f2" : "#f5f3ff",
              border: `1px solid ${pillHovered ? "#fecaca" : "#ddd6fe"}`,
              borderRadius: 100, padding: "5px 10px 5px 8px", cursor: "default",
              transition: "background 240ms ease, border-color 240ms ease",
            }}
          >
            <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: pillHovered ? "#ef4444" : "#8b5cf6", transition: "background 240ms ease" }} />
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: pillHovered ? "#ef4444" : "#8b5cf6", animation: "pl_pulse 1.6s ease-in-out infinite", transition: "background 240ms ease" }} />
            </div>
            <div style={{ position: "relative", display: "inline-block" }}>
              <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", whiteSpace: "nowrap", color: "#6d28d9", opacity: pillHovered ? 0 : 1, transition: "opacity 180ms ease", userSelect: "none" }}>
                In Progress
              </span>
              <button
                onClick={async (e) => { e.stopPropagation(); await handleStopWork() }}
                style={{
                  position: "absolute", inset: "-3px -6px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", border: "1px solid #fecaca", borderRadius: 6, cursor: "pointer",
                  fontSize: 11, fontWeight: 700, color: "#991b1b", whiteSpace: "nowrap", fontFamily: "inherit",
                  opacity: pillHovered ? 1 : 0, pointerEvents: pillHovered ? "auto" : "none",
                  transition: "opacity 180ms ease, background 120ms ease",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#fef2f2" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
              >
                Leave
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Title ── */}
      <div style={{ padding: "6px 26px 14px" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, lineHeight: 1.22, letterSpacing: "-0.025em", color: "#0a0a0a", wordBreak: "break-word" }}>
          {todo.title}
        </h1>
      </div>

      <div style={{ height: 1, background: "#f5f5f5", margin: "0 26px" }} />

      {/* ── Branch ── */}
      <div style={{ padding: "18px 26px 20px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <BranchFeed
          todoId={todo.id}
          isOwner={isOwner}
          refreshKey={refreshKey}
          onSaveDescription={isOwner ? handleSaveDescription : undefined}
          inProgress={inProgress}
          isCompleted={isCompleted}
          onStartWork={handleStartWork}
          onStopWork={handleStopWork}
          onCompleteTask={handleComplete}
          onDuplicate={isOwner ? handleDuplicate : undefined}
        />
      </div>
    </div>
  )
}
