"use client"

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Plus, Zap, Pause, Trash2, X, ListTree, Loader2 } from "lucide-react"
import {
  fetchSubtasks, createSubtask, updateSubtask, deleteSubtask, getApiErrorMessage,
} from "@/lib/api"
import type { Todo } from "@/types/todo"
import { PRIORITY_LEVELS, getPriorityNumber, getPriorityString, getPriorityColor } from "./utils"
import { SPRING_STANDARD } from "@/lib/animations"

export interface SubtasksSectionHandle {
  /** Open the inline create form and focus it (called from the branch "+" menu). */
  openCreate: () => void
}

interface SubtasksSectionProps {
  todoId: string
  /** The viewer owns the parent task — can create, rename, set priority, take into work, delete. */
  isOwner: boolean
  /** Bumping this re-fetches the list (e.g. after the parent's visibility/category changed). */
  refreshKey?: number
}

const SPRING = { type: "spring" as const, stiffness: 460, damping: 32 }

function isDone(s: Todo, isOwner: boolean): boolean {
  if (!isOwner && s.isCompletedByViewer != null) return !!s.isCompletedByViewer
  const st = String(s.status).toLowerCase()
  return st === "done" || st === "completed"
}
function isInProgress(s: Todo): boolean {
  const st = String(s.status).toLowerCase()
  return st === "inprogress" || st === "in progress"
}

export const SubtasksSection = forwardRef<SubtasksSectionHandle, SubtasksSectionProps>(
  function SubtasksSection({ todoId, isOwner, refreshKey }, ref) {
    const [items, setItems] = useState<Todo[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Create form
    const [creating, setCreating] = useState(false)
    const [draftTitle, setDraftTitle] = useState("")
    const [draftPriority, setDraftPriority] = useState("Medium")
    const [submitting, setSubmitting] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    // Per-row in-flight guard so double-clicks can't race.
    const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
    const setPending = (id: string, on: boolean) =>
      setPendingIds((prev) => {
        const next = new Set(prev)
        if (on) next.add(id); else next.delete(id)
        return next
      })

    const load = useCallback(async () => {
      try {
        const list = await fetchSubtasks(todoId)
        setItems(list)
      } catch {
        /* a missing/forbidden parent simply yields no subtasks panel */
      } finally {
        setLoading(false)
      }
    }, [todoId])

    useEffect(() => { void load() }, [load, refreshKey])

    const openCreate = useCallback(() => {
      if (!isOwner) return
      setCreating(true)
      setError(null)
      setTimeout(() => inputRef.current?.focus(), 60)
    }, [isOwner])

    useImperativeHandle(ref, () => ({ openCreate }), [openCreate])

    const submitCreate = async () => {
      const title = draftTitle.trim()
      if (!title || submitting) return
      setSubmitting(true)
      setError(null)
      try {
        const created = await createSubtask(todoId, {
          title,
          priority: getPriorityNumber(draftPriority),
        })
        setItems((prev) => [...prev, created])
        setDraftTitle("")
        setDraftPriority("Medium")
        // Keep the form open for fast successive entry; refocus.
        setTimeout(() => inputRef.current?.focus(), 30)
      } catch (e) {
        setError(getApiErrorMessage(e))
      } finally {
        setSubmitting(false)
      }
    }

    const toggleComplete = async (s: Todo) => {
      if (pendingIds.has(s.id)) return
      const done = isDone(s, isOwner)
      const nextStatus = done ? "todo" : "done"
      setPending(s.id, true)
      // Optimistic flip — instant, satisfying feedback.
      setItems((prev) => prev.map((it) => it.id === s.id
        ? { ...it, status: nextStatus === "done" ? "Done" : "Todo", isCompletedByViewer: isOwner ? it.isCompletedByViewer : nextStatus === "done" }
        : it))
      try {
        await updateSubtask(s.id, { status: nextStatus })
      } catch (e) {
        setItems((prev) => prev.map((it) => it.id === s.id ? s : it)) // revert
        setError(getApiErrorMessage(e))
      } finally {
        setPending(s.id, false)
      }
    }

    const toggleWork = async (s: Todo) => {
      if (!isOwner || pendingIds.has(s.id)) return
      const working = isInProgress(s)
      const nextStatus = working ? "todo" : "inprogress"
      setPending(s.id, true)
      setItems((prev) => prev.map((it) => it.id === s.id
        ? { ...it, status: nextStatus === "inprogress" ? "InProgress" : "Todo" } : it))
      try {
        await updateSubtask(s.id, { status: nextStatus })
      } catch (e) {
        setItems((prev) => prev.map((it) => it.id === s.id ? s : it))
        setError(getApiErrorMessage(e))
      } finally {
        setPending(s.id, false)
      }
    }

    const remove = async (s: Todo) => {
      if (!isOwner || pendingIds.has(s.id)) return
      setPending(s.id, true)
      const snapshot = items
      setItems((prev) => prev.filter((it) => it.id !== s.id)) // optimistic removal (animated out)
      try {
        await deleteSubtask(s.id)
      } catch (e) {
        setItems(snapshot) // restore
        setError(getApiErrorMessage(e))
      } finally {
        setPending(s.id, false)
      }
    }

    const total = items.length
    const completed = items.filter((s) => isDone(s, isOwner)).length

    // Nothing to show for a viewer when there are no subtasks (keeps shared branches clean).
    if (!loading && total === 0 && !isOwner) return null

    return (
      <div
        style={{
          marginLeft: -6, marginRight: -4, marginBottom: 14,
          background: "white", border: "1px solid #f0f0f0", borderRadius: 18,
          padding: "13px 15px 14px", position: "relative", zIndex: 1,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: total > 0 || creating ? 11 : 0 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 8, flexShrink: 0,
            background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <ListTree size={14} color="#4f46e5" strokeWidth={2} />
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "#0a0a0a" }}>
              Subtasks
            </span>
            {total > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: "#a3a3a3", fontVariantNumeric: "tabular-nums" }}>
                {completed}/{total}
              </span>
            )}
          </div>
          {isOwner && !creating && (
            <button
              onClick={openCreate}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "#f5f5f5", border: "none", borderRadius: 9,
                padding: "5px 10px 5px 8px", cursor: "pointer",
                fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em",
                textTransform: "uppercase", color: "#0a0a0a", transition: "background 120ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#ebebeb" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5" }}
            >
              <Plus size={13} strokeWidth={2.4} />
              Add
            </button>
          )}
        </div>

        {/* Subtle progress bar */}
        {total > 0 && (
          <div style={{ height: 3, borderRadius: 2, background: "#f0f0f0", overflow: "hidden", marginBottom: 11 }}>
            <motion.div
              initial={false}
              animate={{ width: `${total ? (completed / total) * 100 : 0}%` }}
              transition={SPRING_STANDARD}
              style={{ height: "100%", background: "#10b981", borderRadius: 2 }}
            />
          </div>
        )}

        {/* List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((s) => (
              <SubtaskRow
                key={s.id}
                subtask={s}
                isOwner={isOwner}
                done={isDone(s, isOwner)}
                working={isInProgress(s)}
                pending={pendingIds.has(s.id)}
                onToggleComplete={() => toggleComplete(s)}
                onToggleWork={() => toggleWork(s)}
                onDelete={() => remove(s)}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* Create form */}
        <AnimatePresence initial={false}>
          {creating && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: "auto", marginTop: total > 0 ? 8 : 0 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={SPRING}
              style={{ overflow: "hidden" }}
            >
              <div style={{
                background: "#fafafa", border: "1.5px solid #e7e9ff", borderRadius: 13, padding: 9,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: getPriorityColor(draftPriority),
                  }} />
                  <input
                    ref={inputRef}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void submitCreate() }
                      if (e.key === "Escape") { setCreating(false); setDraftTitle(""); setError(null) }
                    }}
                    placeholder="Subtask title…"
                    maxLength={200}
                    disabled={submitting}
                    style={{
                      flex: 1, background: "transparent", border: "none", outline: "none",
                      fontSize: 13, fontWeight: 600, color: "#262626", fontFamily: "inherit", minWidth: 0,
                    }}
                  />
                  <button
                    onClick={submitCreate}
                    disabled={!draftTitle.trim() || submitting}
                    style={{
                      width: 30, height: 30, borderRadius: 9, border: "none", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: draftTitle.trim() && !submitting ? "#4f46e5" : "#e5e5e5",
                      cursor: draftTitle.trim() && !submitting ? "pointer" : "default",
                      transition: "background 120ms",
                    }}
                    aria-label="Add subtask"
                  >
                    {submitting
                      ? <Loader2 size={14} color="white" className="animate-spin" />
                      : <Plus size={15} color={draftTitle.trim() ? "white" : "#a3a3a3"} strokeWidth={2.4} />}
                  </button>
                  <button
                    onClick={() => { setCreating(false); setDraftTitle(""); setError(null) }}
                    style={{
                      width: 30, height: 30, borderRadius: 9, border: "none", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "transparent", cursor: "pointer", color: "#a3a3a3",
                    }}
                    aria-label="Cancel"
                  >
                    <X size={15} strokeWidth={2.2} />
                  </button>
                </div>

                {/* Priority picker */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 9, paddingLeft: 1 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a3a3a3", marginRight: 2 }}>
                    Priority
                  </span>
                  {PRIORITY_LEVELS.map((p) => {
                    const active = draftPriority === p.key
                    return (
                      <button
                        key={p.key}
                        onClick={() => setDraftPriority(p.key)}
                        title={p.label}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          height: 22, padding: active ? "0 9px" : "0 7px", borderRadius: 7,
                          border: active ? `1.5px solid ${p.color}` : "1.5px solid transparent",
                          background: active ? `${p.color}14` : "#f0f0f0",
                          cursor: "pointer", transition: "all 120ms",
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.color }} />
                        {active && (
                          <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 800, color: p.color }}>
                            {p.label}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <p style={{ fontSize: 11, color: "#ef4444", marginTop: 8, fontWeight: 600 }}>{error}</p>
        )}
      </div>
    )
  },
)

interface SubtaskRowProps {
  subtask: Todo
  isOwner: boolean
  done: boolean
  working: boolean
  pending: boolean
  onToggleComplete: () => void
  onToggleWork: () => void
  onDelete: () => void
}

function SubtaskRow({ subtask, isOwner, done, working, pending, onToggleComplete, onToggleWork, onDelete }: SubtaskRowProps) {
  const [hovered, setHovered] = useState(false)
  const priorityKey = getPriorityString(subtask.priority)
  const priorityColor = getPriorityColor(priorityKey)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, height: 0, marginTop: -6 }}
      transition={SPRING}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 10px", borderRadius: 12,
        background: done ? "#fafafa" : working ? "#fffdf5" : "#fafafa",
        border: `1px solid ${working && !done ? "#fde68a" : "#f0f0f0"}`,
        transition: "background 160ms, border-color 160ms",
      }}
    >
      {/* Complete toggle */}
      <button
        onClick={onToggleComplete}
        disabled={pending}
        aria-label={done ? "Mark subtask not done" : "Complete subtask"}
        style={{
          width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
          border: done ? "none" : `2px solid ${working ? "#f59e0b" : "#d4d4d4"}`,
          background: done ? "#10b981" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: pending ? "default" : "pointer", padding: 0,
          transition: "background 160ms, border-color 160ms, transform 120ms",
          transform: hovered && !done ? "scale(1.1)" : "scale(1)",
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.span key="done" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={SPRING}>
              <Check size={13} color="white" strokeWidth={3} />
            </motion.span>
          ) : working ? (
            <motion.span key="work" initial={{ scale: 0 }} animate={{ scale: 1 }} className="relative flex">
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b" }} className="animate-pulse" />
            </motion.span>
          ) : hovered ? (
            <motion.span key="hover" initial={{ scale: 0 }} animate={{ scale: 1 }}>
              <Check size={12} color="#10b981" strokeWidth={3} />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </button>

      {/* Title + priority */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: priorityColor, opacity: done ? 0.4 : 1,
          }}
          title={`Priority: ${PRIORITY_LEVELS.find((p) => p.key === priorityKey)?.label ?? priorityKey}`}
        />
        <span style={{
          fontSize: 13, fontWeight: 600, lineHeight: 1.35,
          color: done ? "#a3a3a3" : "#262626",
          textDecoration: done ? "line-through" : "none",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {subtask.title}
        </span>
        {working && !done && (
          <span style={{
            fontSize: 9, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase",
            color: "#b45309", background: "#fef3c7", padding: "2px 6px", borderRadius: 5, flexShrink: 0,
          }}>
            Working
          </span>
        )}
      </div>

      {/* Owner row actions (revealed on hover) */}
      {isOwner && (
        <div style={{
          display: "flex", alignItems: "center", gap: 2, flexShrink: 0,
          opacity: hovered ? 1 : 0, transition: "opacity 140ms",
          pointerEvents: hovered ? "auto" : "none",
        }}>
          {!done && (
            <button
              onClick={onToggleWork}
              disabled={pending}
              aria-label={working ? "Stop working on subtask" : "Take subtask into work"}
              title={working ? "Leave" : "Take into work"}
              style={{
                width: 26, height: 26, borderRadius: 8, border: "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", cursor: "pointer", color: working ? "#b45309" : "#6366f1",
                transition: "background 120ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f0f0f0" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
            >
              {working ? <Pause size={13} strokeWidth={2} /> : <Zap size={13} strokeWidth={2} />}
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={pending}
            aria-label="Delete subtask"
            title="Delete"
            style={{
              width: 26, height: 26, borderRadius: 8, border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", cursor: "pointer", color: "#ef4444",
              transition: "background 120ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#fef2f2" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
      )}
    </motion.div>
  )
}
