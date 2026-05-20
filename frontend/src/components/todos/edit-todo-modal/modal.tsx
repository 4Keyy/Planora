"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { X } from "lucide-react"
import { ModalPortal }      from "@/components/ui/modal-portal"
import { useAuthStore }     from "@/store/auth"
import { useFriends }       from "@/hooks/use-friends"
import { SPRING_STANDARD }  from "@/lib/animations"
import { Todo, type UpdateTodoPayload, isTodoOwner } from "@/types/todo"
import { Category }         from "@/types/category"
import { BranchFeed }       from "./branch-feed"
import { InlineTokenStrip } from "./inline-token-strip"
import {
  getPriorityNumber,
  getPriorityString,
} from "./utils"

type OpenPopover = "priority" | "date" | "category" | "visibility" | null

export interface EditTodoModalProps {
  todo: Todo
  categories: Category[]
  onClose: () => void
  onSave: (payload: UpdateTodoPayload) => Promise<void>
  onSaveViewerPreference: (payload: { viewerCategoryId: string | null }) => Promise<void>
  onCreateCategory: () => Promise<void>
  onDeleteCategory?: (categoryId: string) => Promise<void>
  onLeave?: () => Promise<void>
  commentsRefreshKey?: number
}

export function EditTodoModal({
  todo,
  categories,
  onClose,
  onSave,
  onSaveViewerPreference,
  onCreateCategory,
  onLeave,
  commentsRefreshKey,
}: EditTodoModalProps) {
  const viewerId = useAuthStore((s) => s.user?.userId)
  const viewerName = useAuthStore((s) => {
    const u = s.user as (typeof s.user & { firstName?: string; lastName?: string }) | null
    if (!u) return null
    return [u.firstName, u.lastName].filter(Boolean).join(" ") || null
  })

  const isOwner          = isTodoOwner(todo, viewerId)
  const isFriendVisible  = todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0
  const canManageViewerCategory = !isOwner && isFriendVisible
  const canEditCategory  = isOwner || canManageViewerCategory
  const friends          = useFriends(true)

  // ── State ──────────────────────────────────────────────────────────────────
  const [title,        setTitle]        = useState(todo.title)
  const [priority,     setPriority]     = useState(getPriorityString(todo.priority))
  const [dueDate,      setDueDate]      = useState(
    todo.dueDate ? new Date(todo.dueDate).toISOString().split("T")[0] : ""
  )
  const [categoryId,   setCategoryId]   = useState<string | null>(todo.categoryId ?? null)
  const [openPopover,  setOpenPopover]  = useState<OpenPopover>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [saving,       setSaving]       = useState(false)

  const initialVis = (todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0)
    ? "friends" as const
    : "private" as const
  const [visMode,   setVisMode]   = useState<"private" | "friends">(initialVis)
  const [sharedIds, setSharedIds] = useState<string[]>(
    todo.isPublic ? [] : (todo.sharedWithUserIds ?? [])
  )

  const inProgress = isOwner
    ? String(todo.status ?? "").toLowerCase().replace(/\s/g, "") === "inprogress"
    : (todo.isWorking ?? false)

  const [pillHovered, setPillHovered] = useState(false)

  const titleTextareaRef = useRef<HTMLTextAreaElement>(null)
  const titleH1Ref       = useRef<HTMLHeadingElement>(null)
  const [titleDraft, setTitleDraft] = useState(title)

  // Reset on todo change
  useEffect(() => {
    setTitle(todo.title)
    setTitleDraft(todo.title)
    setPriority(getPriorityString(todo.priority))
    setDueDate(todo.dueDate ? new Date(todo.dueDate).toISOString().split("T")[0] : "")
    setCategoryId(todo.categoryId ?? null)
    setVisMode((todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0) ? "friends" : "private")
    setSharedIds(todo.isPublic ? [] : (todo.sharedWithUserIds ?? []))
  }, [todo.id, todo.title, todo.priority, todo.dueDate, todo.categoryId, todo.isPublic, todo.sharedWithUserIds])

  // Escape key — close modal (unless a popover is open)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (openPopover) { setOpenPopover(null); return }
        if (editingTitle) { setEditingTitle(false); setTitleDraft(title); return }
        onClose()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose, openPopover, editingTitle, title])

  // Auto-height for title textarea
  useEffect(() => {
    if (editingTitle && titleTextareaRef.current) {
      const el = titleTextareaRef.current
      el.style.height = "auto"
      el.style.height = el.scrollHeight + "px"
      el.focus()
    }
  }, [editingTitle])

  const commitTitle = () => {
    const t = titleDraft.trim()
    if (t) setTitle(t)
    else setTitleDraft(title)
    setEditingTitle(false)
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (isOwner && !title.trim()) return
    setSaving(true)
    try {
      if (isOwner) {
        const payload: UpdateTodoPayload = {
          title: title.trim(),
          description: todo.description || null,
          priority: getPriorityNumber(priority),
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
          categoryId: categoryId || null,
          isPublic: false,
          sharedWithUserIds: visMode === "private" ? [] : sharedIds,
          requiredWorkers: visMode === "private" ? null : 1 + sharedIds.length,
          clearRequiredWorkers: visMode === "private",
        }
        await onSave(payload)
      } else {
        await onSaveViewerPreference({ viewerCategoryId: categoryId || null })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }



  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={SPRING_STANDARD}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "relative",
            width: 660,
            maxHeight: "90vh",
            overflowY: "auto",
            borderRadius: 28,
            background: "white",
            boxShadow: "0 30px 80px rgba(0,0,0,0.14), 0 8px 24px rgba(0,0,0,0.05)",
            zIndex: 2001,
            display: "flex",
            flexDirection: "column",
          }}
          className="branch-scroll"
        >
          {/* ── (1) Top chrome bar ── */}
          <div style={{
            padding: "16px 26px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}>
            {/* Left: label + ID */}
            <span style={{
              fontSize: 10, fontWeight: 900, letterSpacing: "0.14em",
              textTransform: "uppercase", color: "#a3a3a3",
            }}>
              Task Branch
            </span>

            {/* Right: in-progress pill + close */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {inProgress && onLeave && (
                <div
                  onMouseEnter={() => setPillHovered(true)}
                  onMouseLeave={() => setPillHovered(false)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: pillHovered ? "#fef2f2" : "#f5f3ff",
                    border: `1px solid ${pillHovered ? "#fecaca" : "#ddd6fe"}`,
                    borderRadius: 100,
                    padding: "5px 10px 5px 8px",
                    cursor: "default",
                    transition: "background 240ms ease, border-color 240ms ease",
                  }}
                >
                  {/* Pulsing dot — violet idle, red on hover */}
                  <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
                    <div style={{
                      position: "absolute", inset: 0, borderRadius: "50%",
                      background: pillHovered ? "#ef4444" : "#8b5cf6",
                      transition: "background 240ms ease",
                    }} />
                    <div style={{
                      position: "absolute", inset: 0, borderRadius: "50%",
                      background: pillHovered ? "#ef4444" : "#8b5cf6",
                      animation: "pl_pulse 1.6s ease-in-out infinite",
                      transition: "background 240ms ease",
                    }} />
                  </div>

                  {/* Label / Leave button — same space, crossfade on hover */}
                  <div style={{ position: "relative", display: "inline-block" }}>
                    {/* "In Progress" keeps the container width even when invisible */}
                    <span style={{
                      display: "block",
                      fontSize: 10, fontWeight: 900, letterSpacing: "0.14em",
                      textTransform: "uppercase", whiteSpace: "nowrap",
                      color: "#6d28d9",
                      opacity: pillHovered ? 0 : 1,
                      transition: "opacity 180ms ease",
                      userSelect: "none",
                    }}>
                      In Progress
                    </span>

                    {/* "Leave" button — absolutely overlaid, fades in on hover */}
                    <button
                      onClick={async (e) => { e.stopPropagation(); await onLeave(); onClose() }}
                      style={{
                        position: "absolute",
                        inset: "-3px -6px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "transparent",
                        border: "1px solid #fecaca",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 11, fontWeight: 700, color: "#991b1b",
                        whiteSpace: "nowrap", fontFamily: "inherit",
                        opacity: pillHovered ? 1 : 0,
                        pointerEvents: pillHovered ? "auto" : "none",
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

              {/* Close button */}
              <button
                onClick={onClose}
                style={{
                  width: 30, height: 30, borderRadius: 10, border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "#fafafa", cursor: "pointer", transition: "background 120ms",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f0f0f0" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#fafafa" }}
              >
                <X size={12} color="#525252" />
              </button>
            </div>
          </div>

          {/* ── (2) Title heading ── */}
          <div style={{ padding: "22px 26px 12px" }}>
            {editingTitle && isOwner ? (
              <textarea
                ref={titleTextareaRef}
                value={titleDraft}
                onChange={(e) => {
                  setTitleDraft(e.target.value)
                  e.target.style.height = "auto"
                  e.target.style.height = e.target.scrollHeight + "px"
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitTitle() }
                  if (e.key === "Escape") { setEditingTitle(false); setTitleDraft(title) }
                }}
                onBlur={commitTitle}
                maxLength={200}
                rows={1}
                style={{
                  width: "100%", resize: "none", border: "none", outline: "none",
                  background: "#fafafa", borderRadius: 14, padding: "10px 14px",
                  marginLeft: -14,
                  fontSize: 22, fontWeight: 900, lineHeight: 1.22,
                  letterSpacing: "-0.025em", color: "#0a0a0a",
                  fontFamily: "inherit", boxSizing: "border-box",
                  overflow: "hidden",
                }}
              />
            ) : (
              <h1
                ref={titleH1Ref}
                onClick={() => isOwner && setEditingTitle(true)}
                style={{
                  fontSize: 22, fontWeight: 900, lineHeight: 1.22,
                  letterSpacing: "-0.025em", color: "#0a0a0a",
                  cursor: isOwner ? "text" : "default",
                  padding: "8px 12px",
                  marginLeft: -12,
                  borderRadius: 10,
                  background: "transparent",
                  transition: "background 140ms",
                  margin: 0,
                  wordBreak: "break-word",
                }}
                onMouseEnter={(e) => { if (isOwner) (e.currentTarget as HTMLHeadingElement).style.background = "#fafafa" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLHeadingElement).style.background = "transparent" }}
              >
                {title}
              </h1>
            )}
          </div>

          {/* ── (3) Inline token meta strip ── */}
          <div style={{ padding: "0 22px 18px 22px" }}>
            <InlineTokenStrip
              priority={priority}
              onPriorityChange={setPriority}
              dueDate={dueDate}
              onDueDateChange={(v) => setDueDate(v ?? "")}
              categoryId={categoryId}
              onCategoryChange={setCategoryId}
              categories={categories}
              onCreateCategory={onCreateCategory}
              canEditCategory={canEditCategory}
              authorCategoryName={todo.authorCategoryName}
              authorCategoryColor={todo.authorCategoryColor}
              authorCategoryIcon={todo.authorCategoryIcon}
              isOwner={isOwner}
              visMode={visMode}
              onVisModeChange={setVisMode}
              sharedIds={sharedIds}
              onSharedIdsChange={setSharedIds}
              friends={friends}
              openPopover={openPopover}
              setOpenPopover={setOpenPopover}
              disabled={!isOwner && !canManageViewerCategory}
            />
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "#f5f5f5", margin: "0 26px" }} />

          {/* ── (4) Branch panel ── */}
          <div style={{ padding: "18px 26px 20px" }}>
            <BranchFeed
              todoId={todo.id}
              isOwner={isOwner}
              refreshKey={commentsRefreshKey}
            />
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "#f0f0f0" }} />

          {/* ── (5) Footer ── */}
          <div style={{
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "white",
            borderRadius: "0 0 28px 28px",
          }}>
            <button
              onClick={onClose}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                padding: "12px 18px", borderRadius: 14,
                fontSize: 12, fontWeight: 900, letterSpacing: "0.04em",
                textTransform: "uppercase", color: "#525252",
                transition: "background 120ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
            >
              Cancel
            </button>

            <div style={{ flex: 1 }} />

            <button
              onClick={handleSave}
              disabled={saving || (isOwner ? !title.trim() : !canManageViewerCategory)}
              style={{
                padding: "12px 22px", borderRadius: 14, border: "none", cursor: "pointer",
                background: (saving || (isOwner && !title.trim()) || (!isOwner && !canManageViewerCategory))
                  ? "#e5e5e5"
                  : "#0a0a0a",
                color: (saving || (isOwner && !title.trim()) || (!isOwner && !canManageViewerCategory))
                  ? "#a3a3a3"
                  : "white",
                fontSize: 12, fontWeight: 900, letterSpacing: "0.04em",
                textTransform: "uppercase",
                boxShadow: saving ? "none" : "0 4px 14px rgba(0,0,0,0.18)",
                transition: "background 120ms, box-shadow 120ms",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  )
}
