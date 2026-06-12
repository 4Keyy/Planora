"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { X } from "lucide-react"
import { ModalPortal }      from "@/components/ui/modal-portal"
import { useAutosave }      from "@/hooks/use-autosave"
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

/**
 * Equality for the owner autosave channel that deliberately ignores `description`.
 * The description has a dedicated editor (the branch's "Author's Note") that persists
 * it directly, so changes to it must not trigger a second write from this channel.
 */
function samePayloadExceptDescription(a: UpdateTodoPayload, b: UpdateTodoPayload): boolean {
  return (
    a.title === b.title &&
    a.priority === b.priority &&
    a.dueDate === b.dueDate &&
    a.categoryId === b.categoryId &&
    a.isPublic === b.isPublic &&
    a.requiredWorkers === b.requiredWorkers &&
    a.clearRequiredWorkers === b.clearRequiredWorkers &&
    JSON.stringify(a.sharedWithUserIds ?? []) === JSON.stringify(b.sharedWithUserIds ?? [])
  )
}

/**
 * Build the owner payload that the modal's local state is initialised from, straight
 * from a task. Used as the autosave baseline so a freshly-opened task is never seen as
 * "dirty". Mirrors the field initialisation and `buildOwnerPayload` normalisation.
 */
function todoToOwnerPayload(todo: Todo): UpdateTodoPayload {
  const visFriends = todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0
  const shared = todo.isPublic ? [] : (todo.sharedWithUserIds ?? [])
  const dueDate = todo.dueDate
    ? new Date(new Date(todo.dueDate).toISOString().split("T")[0]).toISOString()
    : null
  return {
    title: todo.title.trim(),
    description: (todo.description ?? "").trim() || null,
    priority: getPriorityNumber(getPriorityString(todo.priority)),
    dueDate,
    categoryId: todo.categoryId || null,
    isPublic: false,
    sharedWithUserIds: visFriends ? shared : [],
    requiredWorkers: visFriends ? 1 + shared.length : null,
    clearRequiredWorkers: !visFriends,
  }
}

export interface EditTodoModalProps {
  todo: Todo
  categories: Category[]
  onClose: () => void
  onSave: (payload: UpdateTodoPayload) => Promise<void>
  onSaveViewerPreference: (payload: { viewerCategoryId: string | null }) => Promise<void>
  onCreateCategory: () => Promise<void>
  onDeleteCategory?: (categoryId: string) => Promise<void>
  onLeave?: () => Promise<void>
  /** Take the task into work (owner → In Progress, viewer → join). */
  onStartWork?: () => Promise<void>
  /** Complete (or, when already completed, reopen) the task. */
  onCompleteTask?: () => Promise<void>
  /** Duplicate the task into a fresh copy (owner-only; surfaced for completed tasks). */
  onDuplicate?: () => Promise<void>
  onDescriptionChange?: (newDescription: string) => void
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
  onStartWork,
  onCompleteTask,
  onDuplicate,
  onDescriptionChange,
  commentsRefreshKey,
}: EditTodoModalProps) {
  const viewerId = useAuthStore((s) => s.user?.userId)

  const isOwner          = isTodoOwner(todo, viewerId)
  const isFriendVisible  = todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0
  const canManageViewerCategory = !isOwner && isFriendVisible
  const canEditCategory  = isOwner || canManageViewerCategory
  const friends          = useFriends(true)

  // ── State ──────────────────────────────────────────────────────────────────
  const [title,        setTitle]        = useState(todo.title)
  // The description is the single source of truth on the task itself (not a stored
  // comment). The branch's "Author's Note" edits it through onSaveDescription below.
  const [description,  setDescription]  = useState(todo.description ?? "")
  const [priority,     setPriority]     = useState(getPriorityString(todo.priority))
  const [dueDate,      setDueDate]      = useState(
    todo.dueDate ? new Date(todo.dueDate).toISOString().split("T")[0] : ""
  )
  const [categoryId,   setCategoryId]   = useState<string | null>(todo.categoryId ?? null)
  const [openPopover,  setOpenPopover]  = useState<OpenPopover>(null)
  const [editingTitle, setEditingTitle] = useState(false)

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

  const statusKey = String(todo.status ?? "").toLowerCase().replace(/\s/g, "")
  const isCompleted = isOwner
    ? (statusKey === "done" || statusKey === "completed")
    : (todo.isCompletedByViewer ?? false)

  // Optimistic working state so the compose-panel toggle and the pill flip instantly,
  // before the parent's refetch propagates back through the `todo` prop. Reset per task.
  const [workOverride, setWorkOverride] = useState<boolean | null>(null)
  useEffect(() => { setWorkOverride(null) }, [todo.id])
  const effectiveInProgress = workOverride ?? inProgress

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

  // ── Autosave ────────────────────────────────────────────────────────────────
  // No Save button: every committed field change is persisted automatically. The
  // owner channel persists the full task payload; a shared viewer persists only their
  // private category preference. Both are debounced and single-flight (see useAutosave).

  // Full owner payload. `descOverride` lets the branch persist a description edit
  // without disturbing the other fields (single source of truth = the task).
  const buildOwnerPayload = useCallback((descOverride?: string | null): UpdateTodoPayload => ({
    title: title.trim(),
    description: descOverride !== undefined ? descOverride : (description.trim() || null),
    priority: getPriorityNumber(priority),
    dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    categoryId: categoryId || null,
    isPublic: false,
    sharedWithUserIds: visMode === "private" ? [] : sharedIds,
    requiredWorkers: visMode === "private" ? null : 1 + sharedIds.length,
    clearRequiredWorkers: visMode === "private",
  }), [title, description, priority, dueDate, categoryId, visMode, sharedIds])

  const ownerPayload = useMemo(() => buildOwnerPayload(), [buildOwnerPayload])

  const ownerAutosave = useAutosave<UpdateTodoPayload>({
    value: ownerPayload,
    enabled: isOwner,
    onSave,
    // Title is the only required field; an empty title is never persisted (and the
    // inline editor already reverts blank titles, so this is a belt-and-braces guard).
    validate: (p) => (p.title ?? "").trim().length > 0,
    // The description is owned by the branch's "Author's Note" editor, which persists
    // it on its own. Excluding it here prevents a duplicate write when a note is saved.
    isEqual: samePayloadExceptDescription,
  })

  const viewerAutosave = useAutosave<string | null>({
    value: categoryId || null,
    enabled: !isOwner && canManageViewerCategory,
    onSave: (viewerCategoryId) => onSaveViewerPreference({ viewerCategoryId }),
  })

  // Re-anchor both baselines whenever the edited task changes, so switching tasks
  // never persists the old task's values against the new one.
  useEffect(() => {
    ownerAutosave.reset(todoToOwnerPayload(todo))
    viewerAutosave.reset(todo.categoryId ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo.id])

  // Persist a description edit from the branch's "Author's Note" immediately to the
  // task (the single source of truth) — no modal close, other fields untouched.
  const handleSaveDescription = async (newDescription: string) => {
    const trimmed = newDescription.trim()
    await onSave(buildOwnerPayload(trimmed || null))
    setDescription(trimmed)
    onDescriptionChange?.(trimmed)
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
            // Fixed size regardless of content: the modal is always the same (max) height,
            // whether the branch is empty or full. The branch feed in the middle flex-fills
            // and scrolls internally, so title/meta/footer stay put.
            height: "90vh",
            maxHeight: 880,
            overflow: "hidden",
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
              {effectiveInProgress && onLeave && (
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

                    {/* "Leave" button — absolutely overlaid, fades in on hover.
                        Leaving keeps the modal open (the "left the task" event shows in the branch). */}
                    <button
                      onClick={async (e) => { e.stopPropagation(); setWorkOverride(false); await onLeave() }}
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
                  // Box model mirrors the <h1> below exactly (same padding, negative margin,
                  // radius and font metrics) so entering edit mode never shifts the title
                  // sideways or resizes it — it just fades from the hover background into a field.
                  display: "block",
                  width: "calc(100% + 12px)",
                  marginLeft: -12,
                  resize: "none", border: "none", outline: "none",
                  background: "#fafafa", borderRadius: 10, padding: "8px 12px",
                  fontSize: 22, fontWeight: 900, lineHeight: 1.22,
                  letterSpacing: "-0.025em", color: "#0a0a0a",
                  fontFamily: "inherit", boxSizing: "border-box",
                  overflow: "hidden",
                  transition: "background 140ms",
                }}
              />
            ) : (
              <h1
                ref={titleH1Ref}
                onClick={() => isOwner && setEditingTitle(true)}
                style={{
                  // Box model mirrors the <textarea> above EXACTLY (display, width, negative
                  // left margin, border-box, padding, radius and font metrics) so clicking to
                  // edit fades the heading into the field with zero horizontal shift or resize.
                  // NB: a shorthand `margin: 0` here previously clobbered `marginLeft`, snapping
                  // the heading 12px right of the field — hence the "title slides left" jump.
                  display: "block",
                  width: "calc(100% + 12px)",
                  marginLeft: -12,
                  marginTop: 0, marginRight: 0, marginBottom: 0,
                  boxSizing: "border-box",
                  fontSize: 22, fontWeight: 900, lineHeight: 1.22,
                  letterSpacing: "-0.025em", color: "#0a0a0a",
                  cursor: isOwner ? "text" : "default",
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "transparent",
                  transition: "background 140ms",
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
            />
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "#f5f5f5", margin: "0 26px" }} />

          {/* ── (4) Branch panel ── (flex-fills the fixed-height modal; scrolls internally) */}
          <div style={{ padding: "18px 26px 20px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <BranchFeed
              todoId={todo.id}
              isOwner={isOwner}
              refreshKey={commentsRefreshKey}
              onSaveDescription={isOwner ? handleSaveDescription : undefined}
              inProgress={effectiveInProgress}
              isCompleted={isCompleted}
              onStartWork={onStartWork ? async () => { setWorkOverride(true); await onStartWork() } : undefined}
              onStopWork={onLeave ? async () => { setWorkOverride(false); await onLeave() } : undefined}
              onCompleteTask={onCompleteTask ? async () => { await onCompleteTask(); onClose() } : undefined}
              onDuplicate={onDuplicate ? async () => { await onDuplicate(); onClose() } : undefined}
            />
          </div>

        </motion.div>
      </div>
    </ModalPortal>
  )
}
