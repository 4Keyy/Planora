"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { X, ExternalLink, ArrowLeft } from "lucide-react"
import { ModalPortal }      from "@/components/ui/modal-portal"
import { useAutosave }      from "@/hooks/use-autosave"
import { useAuthStore }     from "@/store/auth"
import { useFriends }       from "@/hooks/use-friends"
import { SPRING_STANDARD }  from "@/lib/animations"
import { Todo, type UpdateTodoPayload, isTodoOwner } from "@/types/todo"
import { Category }         from "@/types/category"
import { BranchFeed }       from "./branch-feed"
import { InlineTokenStrip } from "./inline-token-strip"
import { PageMetaPanel }    from "./page-meta-panel"
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
    a.dueDateStart === b.dueDateStart &&
    a.clearDueDate === b.clearDueDate &&
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
  const dueDateStart = todo.dueDateStart
    ? new Date(new Date(todo.dueDateStart).toISOString().split("T")[0]).toISOString()
    : null
  return {
    title: todo.title.trim(),
    description: (todo.description ?? "").trim() || null,
    priority: getPriorityNumber(getPriorityString(todo.priority)),
    dueDate,
    dueDateStart,
    clearDueDate: !todo.dueDate,
    categoryId: todo.categoryId || null,
    isPublic: false,
    sharedWithUserIds: visFriends ? shared : [],
    requiredWorkers: visFriends ? 1 + shared.length : null,
    clearRequiredWorkers: !visFriends,
  }
}

export interface TodoEditorProps {
  /** "modal" wraps the editor in the centred dialog chrome; "page" renders it inline on its
      own route. The chrome (close/open-page vs. back-link) and Escape behaviour differ; the body
      — title, meta strip, popovers and branch — is identical. */
  variant?: "modal" | "page"
  todo: Todo
  categories: Category[]
  onClose?: () => void
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

/** Props for the modal wrapper — same as the editor but the close handler is required. */
export type EditTodoModalProps = Omit<TodoEditorProps, "variant"> & { onClose: () => void }

/**
 * The full task editor body — title, the inline meta strip (priority / due date / category /
 * visibility popovers) and the branch — shared by the in-place modal and the standalone
 * `/branch/{id}` page. Fills its container (height: 100%); the wrapper sizes it.
 */
export function TodoEditor({
  variant = "modal",
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
}: TodoEditorProps) {
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
  // The optional START bound of the estimated-completion interval (empty for a single date).
  const [dueDateStart, setDueDateStart] = useState(
    todo.dueDateStart ? new Date(todo.dueDateStart).toISOString().split("T")[0] : ""
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

  // Initialise the editor's local fields from the task — ONLY when switching to a different task
  // (todo.id). Deliberately NOT on every todo field change: the editor owns these fields while open,
  // and after an autosave the parent may feed back the saved task (e.g. the standalone page updates
  // its `todo` state). Re-seeding on those updates made the controls "snap back" — most visibly
  // visibility flipping friends→private when the saved data (isPublic:false, sharedWith:[]) is
  // indistinguishable from private. Seeding once per task keeps the user's selection stable.
  useEffect(() => {
    setTitle(todo.title)
    setTitleDraft(todo.title)
    setPriority(getPriorityString(todo.priority))
    setDueDate(todo.dueDate ? new Date(todo.dueDate).toISOString().split("T")[0] : "")
    setDueDateStart(todo.dueDateStart ? new Date(todo.dueDateStart).toISOString().split("T")[0] : "")
    setCategoryId(todo.categoryId ?? null)
    setVisMode((todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0) ? "friends" : "private")
    setSharedIds(todo.isPublic ? [] : (todo.sharedWithUserIds ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo.id])

  // Escape key — peel back popover, then title edit, then (modal only) close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (openPopover) { setOpenPopover(null); return }
        if (editingTitle) { setEditingTitle(false); setTitleDraft(title); return }
        onClose?.()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose, openPopover, editingTitle, title])

  // Auto-height for the title textarea — sized BEFORE paint (useLayoutEffect) so entering edit mode
  // never shows a one-frame single-row textarea that then jumps to the full height. Focus after.
  useLayoutEffect(() => {
    if (editingTitle && titleTextareaRef.current) {
      const el = titleTextareaRef.current
      el.style.height = "auto"
      el.style.height = el.scrollHeight + "px"
    }
  }, [editingTitle])

  useEffect(() => {
    if (editingTitle && titleTextareaRef.current) {
      const el = titleTextareaRef.current
      el.focus()
      // Place the caret at the END of the existing title (not the left edge, which is
      // where a bare focus() lands) so editing continues from where the text finishes.
      const end = el.value.length
      el.setSelectionRange(end, end)
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
    dueDateStart: dueDateStart ? new Date(dueDateStart).toISOString() : null,
    // No end bound → no date at all: signal an explicit clear (a null dueDate alone reads as
    // "unchanged" server-side). When an end is present this is false and the interval is set.
    clearDueDate: !dueDate,
    categoryId: categoryId || null,
    isPublic: false,
    sharedWithUserIds: visMode === "private" ? [] : sharedIds,
    requiredWorkers: visMode === "private" ? null : 1 + sharedIds.length,
    clearRequiredWorkers: visMode === "private",
  }), [title, description, priority, dueDate, dueDateStart, categoryId, visMode, sharedIds])

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



  const isPage = variant === "page"

  // ── Reusable nodes (shared by the modal and page layouts) ──

  // The editable title — same logic for both layouts; only the sizing/inset differs.
  const renderTitle = (fontSize: number, inset: number, vpad: number) => {
    const box: CSSProperties = {
      display: "block",
      width: `calc(100% + ${inset}px)`,
      marginLeft: -inset,
      padding: `${vpad}px ${inset}px`,
      boxSizing: "border-box",
      fontSize, fontWeight: 900, lineHeight: 1.22, letterSpacing: "-0.025em",
      color: "#0a0a0a", borderRadius: 10,
    }
    return editingTitle && isOwner ? (
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
          ...box,
          resize: "none", border: "none", outline: "none",
          background: "#fafafa", fontFamily: "inherit", overflow: "hidden",
          transition: "background 140ms",
        }}
      />
    ) : (
      <h1
        ref={titleH1Ref}
        onClick={() => isOwner && setEditingTitle(true)}
        style={{
          ...box,
          marginTop: 0, marginRight: 0, marginBottom: 0,
          cursor: isOwner ? "text" : "default",
          background: "transparent", transition: "background 140ms", wordBreak: "break-word",
        }}
        onMouseEnter={(e) => { if (isOwner) (e.currentTarget as HTMLHeadingElement).style.background = "#fafafa" }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLHeadingElement).style.background = "transparent" }}
      >
        {title}
      </h1>
    )
  }

  // The In Progress pill (with hover → Leave). Shown when the viewer has the task in progress.
  const pillNode = effectiveInProgress && onLeave ? (
    <div
      onMouseEnter={() => setPillHovered(true)}
      onMouseLeave={() => setPillHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
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
          onClick={async (e) => { e.stopPropagation(); setWorkOverride(false); await onLeave() }}
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
  ) : null

  // The branch timeline (flex-fills its column).
  const branchNode = (
    <BranchFeed
      todoId={todo.id}
      isOwner={isOwner}
      refreshKey={commentsRefreshKey}
      onSaveDescription={isOwner ? handleSaveDescription : undefined}
      inProgress={effectiveInProgress}
      isCompleted={isCompleted}
      ownerCompleted={todo.ownerCompleted ?? false}
      openSubtaskCount={todo.openSubtaskCount}
      onStartWork={onStartWork ? async () => { setWorkOverride(true); await onStartWork() } : undefined}
      onStopWork={onLeave ? async () => { setWorkOverride(false); await onLeave() } : undefined}
      // The modal closes after complete/duplicate; the page stays (duplicate navigates itself).
      onCompleteTask={onCompleteTask ? async () => { await onCompleteTask(); onClose?.() } : undefined}
      onDuplicate={onDuplicate ? async () => { await onDuplicate(); onClose?.() } : undefined}
    />
  )

  const metaProps = {
    priority, onPriorityChange: setPriority,
    dueDate, dueDateStart,
    onDueRangeChange: (start: string | null, end: string | null) => {
      setDueDateStart(start ?? "")
      setDueDate(end ?? "")
    },
    categoryId, onCategoryChange: setCategoryId,
    categories, onCreateCategory, canEditCategory,
    authorCategoryName: todo.authorCategoryName,
    authorCategoryColor: todo.authorCategoryColor,
    authorCategoryIcon: todo.authorCategoryIcon,
    isOwner,
    visMode, onVisModeChange: setVisMode,
    sharedIds, onSharedIdsChange: setSharedIds,
    friends, openPopover, setOpenPopover,
  }

  // ── Page layout ── wide, two-column: a compact meta sidebar on the left, the branch on the
  // right, and a header row carrying the Task Branch label + the editable title + the pill.
  if (isPage) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* Header — mirrors the body's two columns so the editable title lines up with the BRANCH
            (right column), not its settings. The "Task Branch" back-link sits over the settings
            sidebar (left); the title + pill align with the branch content via the same lg:pl-6. */}
        <div
          style={{ padding: "16px 26px 0" }}
          className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-0"
        >
          {/* Left — spans the settings sidebar (389px) + the 1px divider */}
          <div className="flex-shrink-0 lg:w-[390px]">
            <Link
              href="/tasks"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6,
                fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase",
                color: "#a3a3a3", textDecoration: "none",
              }}
            >
              <ArrowLeft size={13} strokeWidth={2.4} /> Task Branch
            </Link>
          </div>

          {/* Right — aligned with the branch content (same lg:pl-6 as the body's branch column) */}
          <div className="flex min-w-0 flex-1 items-start gap-3 lg:pl-6">
            <div style={{ flex: 1, minWidth: 0 }}>
              {renderTitle(20, 12, 6)}
            </div>
            {pillNode && <div style={{ marginTop: 6, flexShrink: 0 }}>{pillNode}</div>}
          </div>
        </div>

        {/* Body: meta sidebar | branch — stacks vertically on phones, two columns on lg+ so the
            fixed 389px sidebar never overflows a narrow screen. */}
        <div
          style={{ flex: 1, minHeight: 0, padding: "14px 26px 22px" }}
          className="flex flex-col gap-4 lg:flex-row lg:gap-0"
        >
          <div className="branch-scroll w-full flex-shrink-0 lg:w-[389px] lg:overflow-y-auto lg:pr-6">
            <PageMetaPanel {...metaProps} />
          </div>
          <div style={{ background: "#f5f5f5" }} className="hidden w-px flex-shrink-0 lg:block" />
          <div className="flex min-w-0 flex-1 flex-col lg:pl-6">
            {branchNode}
          </div>
        </div>
      </div>
    )
  }

  // ── Modal layout ── single column: chrome bar, title, horizontal meta strip, branch.
  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
      className="branch-scroll"
    >
      {/* ── (1) Top chrome bar ── (tighter side padding on phones for more content width) */}
      <div className="flex items-center justify-between gap-2 px-4 py-4 sm:px-[26px]">
        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a3a3a3" }}>
          Task Branch
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Open this branch on its own page (new tab) — grey, same row as the pill. */}
          <button
            onClick={() => window.open(`/branch/${todo.id}`, "_blank", "noopener,noreferrer")}
            title="Open this branch on its own page"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              background: "transparent", border: "none", cursor: "pointer",
              padding: "5px 6px", borderRadius: 8,
              fontSize: 11, fontWeight: 700, letterSpacing: "0.02em",
              color: "#a3a3a3", fontFamily: "inherit",
              transition: "color 120ms, background 120ms",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#525252"
              ;(e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5"
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#a3a3a3"
              ;(e.currentTarget as HTMLButtonElement).style.background = "transparent"
            }}
          >
            <ExternalLink size={12} strokeWidth={2} />
            Open page
          </button>

          {pillNode}

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
      <div className="px-4 pt-[22px] pb-3 sm:px-[26px]">
        {renderTitle(22, 12, 8)}
      </div>

      {/* ── (3) Inline token meta strip ── */}
      <div className="px-4 pb-[18px] sm:px-[22px]">
        <InlineTokenStrip {...metaProps} />
      </div>

      {/* Divider */}
      <div className="mx-4 sm:mx-[26px]" style={{ height: 1, background: "#f5f5f5" }} />

      {/* ── (4) Branch panel ── (flex-fills the container; scrolls internally) */}
      <div className="flex flex-1 flex-col px-4 pb-5 pt-[18px] sm:px-[26px]" style={{ minHeight: 0 }}>
        {branchNode}
      </div>
    </div>
  )
}

/**
 * In-place dialog wrapper around {@link TodoEditor} — backdrop, centred card, and close-on-backdrop.
 * The standalone `/branch/{id}` page renders {@link TodoEditor} directly with `variant="page"`.
 */
export function EditTodoModal(props: EditTodoModalProps) {
  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
        onClick={props.onClose}
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
        />

        {/* Modal card — fixed size; the branch in the middle flex-fills and scrolls internally. */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={SPRING_STANDARD}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "relative",
            // Responsive width: fills the padded viewport on phones (the parent's
            // p-4 reserves 16px gutters), capped at 660px on larger screens. A hard
            // 660px width overflowed the screen on mobile and cut off the card.
            width: "100%",
            maxWidth: 660,
            height: "90vh",
            maxHeight: 880,
            overflow: "hidden",
            borderRadius: 28,
            background: "white",
            boxShadow: "0 30px 80px rgba(0,0,0,0.14), 0 8px 24px rgba(0,0,0,0.05)",
            zIndex: 2001,
          }}
        >
          <TodoEditor variant="modal" {...props} />
        </motion.div>
      </div>
    </ModalPortal>
  )
}
