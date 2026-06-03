"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Pencil, Trash2, Send, Plus, FileText, X, ChevronUp, Zap, Pause, LogOut, CheckCircle2, Loader2, Check, Play, Circle, ListTree, type LucideIcon } from "lucide-react"
import {
  fetchComments, addComment, updateComment, deleteComment,
  fetchSubtasks, createSubtask, updateSubtask, deleteSubtask,
  getApiErrorMessage,
} from "@/lib/api"
import type { TodoComment, Todo } from "@/types/todo"
import { SPRING_STANDARD } from "@/lib/animations"
import { FriendAvatar } from "./friend-avatar"
import {
  formatDayLabel,
  formatTimeHHMM,
} from "./utils"

const COMMENT_MAX = 2000
const GENESIS_MAX = 5000
const SUBTASK_MAX = 1500

// Snappy spring for subtask micro-interactions (toggle pop, card enter/exit).
const SPRING_SNAP = { type: "spring" as const, stiffness: 460, damping: 32 }

// Activity-rail geometry. The rail line is centred at RAIL_CENTER within a wrapper that pads its
// content by RAIL_GUTTER, and every marker is centred on that same x so avatars and system-event
// badges sit exactly on the line. Markers are placed at: left = RAIL_CENTER - RAIL_GUTTER - size/2.
const RAIL_GUTTER = 40
const RAIL_CENTER = 20

// Maps a system-event comment to a simple, monochrome icon that hints at its meaning.
// Matches the English event sentences Todo emits (and keeps the legacy Russian keywords).
// Markers are intentionally greyscale (see SystemEvent) so the rail stays calm and uncluttered.
function getSystemEventIcon(content: string): LucideIcon {
  const t = content.toLowerCase()
  if (t.includes("subtask") || t.includes("под-задач") || t.includes("подзадач")) return ListTree
  if (t.includes("complet") || t.includes("завершил") || t.includes("выполнил")) return Check
  if (t.includes("start") || t.includes("working") || t.includes("взял в работу") || t.includes("присоединил")) return Play
  if (t.includes("left") || t.includes("leav") || t.includes("покинул") || t.includes("приостановил")) return LogOut
  if (t.includes("creat") || t.includes("создал")) return Plus
  return Circle
}

// Completion is global: anyone with access marks a subtask done for everyone, so the entity status
// is the single source of truth (no per-viewer state).
function isSubtaskDone(s: Todo): boolean {
  const st = String(s.status).toLowerCase()
  return st === "done" || st === "completed"
}
function isSubtaskWorking(s: Todo): boolean {
  const st = String(s.status).toLowerCase()
  return st === "inprogress" || st === "in progress"
}

interface BranchFeedProps {
  todoId: string
  isOwner: boolean
  refreshKey?: number
  // Persists the task description (the single source of truth, owned by Todo). The pinned
  // "Author's Note" is this description — editing/adding/clearing it goes through here, not a
  // stored genesis comment. Undefined for non-owners (read-only note).
  onSaveDescription?: (text: string) => Promise<void>
  // ── Compose-panel task actions (surfaced inside the "+" menu) ──
  // Whether the viewer currently has this task in progress (owner) / is working on it (viewer).
  inProgress?: boolean
  // Whether the task is already completed (toggles the complete action into a "reopen").
  isCompleted?: boolean
  // Take the task into work (owner → In Progress, viewer → join). Hidden when undefined.
  onStartWork?: () => Promise<void>
  // Stop working / leave the task. Hidden when undefined.
  onStopWork?: () => Promise<void>
  // Complete (or reopen) the task. Hidden when undefined.
  onCompleteTask?: () => Promise<void>
}

// Compose modes — a plain branch message, the task description, or a new subtask. Subtasks are
// authored exactly like the description: pick it from the "+" menu, type into the same field, send.
type ComposeMode = "text" | "description" | "subtask"

// Completion attribution for a subtask, parsed from its (now hidden) "completed a subtask" system
// comment and rendered as a no-icon reply in the subtask's sub-branch. Creation is intentionally
// NOT surfaced — a subtask never shows a "created" notification.
interface SubtaskMeta {
  completedBy?: string
  completedAt?: string
}

// Flat list item (day separator, comment, or an inline subtask card cluster)
type FeedItem =
  | { type: "separator"; label: string; key: string }
  | { type: "comment";   comment: TodoComment }
  | { type: "subtask";   subtask: Todo; meta: SubtaskMeta }

// Pulls the actor's name out of a subtask system sentence, e.g. "Ann Lee completed a subtask: Buy milk".
function parseSubtaskActor(content: string, verb: "added" | "completed"): string | undefined {
  const m = content.match(new RegExp(`^(.*?)\\s+${verb} a subtask:`, "i"))
  const name = m?.[1]?.trim()
  return name || undefined
}

// Builds the chronological rail by interleaving branch comments with subtask card clusters. A
// subtask's lifecycle system comments are never rendered as standalone rail nodes: the "added a
// subtask" comment is dropped entirely (no creation notification at all), and the "completed a
// subtask" comment is hidden and parsed into the completion reply shown inside the subtask's own
// sub-branch. Cards anchor on their own creation time.
function buildFeed(comments: TodoComment[], subtasks: Todo[]): FeedItem[] {
  const creationEvents = comments.filter((c) => c.isSystemComment && /added a subtask:/i.test(c.content))
  const completionEvents = comments.filter((c) => c.isSystemComment && /completed a subtask:/i.test(c.content))

  const usedCreate = new Set<string>()
  const usedComplete = new Set<string>()
  const hidden = new Set<string>()            // subtask system comments — never rendered on the rail
  const metaById = new Map<string, SubtaskMeta>()

  // Match in creation order for stable greedy pairing when titles repeat.
  const subsByTime = [...subtasks].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  for (const s of subsByTime) {
    const suffix = `: ${s.title}`
    const meta: SubtaskMeta = {}

    // Hide the creation comment if one still exists (legacy / in-flight) — it is never shown.
    const created = creationEvents.find((c) => !usedCreate.has(c.id) && c.content.trimEnd().endsWith(suffix))
    if (created) {
      usedCreate.add(created.id)
      hidden.add(created.id)
    }

    const completed = completionEvents.find((c) => !usedComplete.has(c.id) && c.content.trimEnd().endsWith(suffix))
    if (completed) {
      usedComplete.add(completed.id)
      hidden.add(completed.id)
      meta.completedBy = parseSubtaskActor(completed.content, "completed")
      meta.completedAt = completed.createdAt
    }

    metaById.set(s.id, meta)
  }

  type Ev =
    | { time: string; order: number; kind: "comment"; comment: TodoComment }
    | { time: string; order: number; kind: "subtask"; subtask: Todo }
  const evs: Ev[] = []
  for (const c of comments) {
    if (hidden.has(c.id)) continue            // subtask system comment — folded away
    evs.push({ time: c.createdAt, order: 0, kind: "comment", comment: c })
  }
  // The subtask card anchors on its own creation time; order:1 keeps it after same-time comments.
  for (const s of subtasks) evs.push({ time: s.createdAt, order: 1, kind: "subtask", subtask: s })
  evs.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.order - b.order))

  const items: FeedItem[] = []
  let lastDay = ""
  let sepIdx = 0
  for (const e of evs) {
    const day = formatDayLabel(e.time)
    if (day !== lastDay) {
      items.push({ type: "separator", label: day, key: `sep-${sepIdx++}-${e.time}` })
      lastDay = day
    }
    if (e.kind === "comment") items.push({ type: "comment", comment: e.comment })
    else items.push({ type: "subtask", subtask: e.subtask, meta: metaById.get(e.subtask.id) ?? {} })
  }
  return items
}

export function BranchFeed({
  todoId, isOwner, refreshKey, onSaveDescription,
  inProgress = false, isCompleted = false,
  onStartWork, onStopWork, onCompleteTask,
}: BranchFeedProps) {
  const [comments,   setComments]   = useState<TodoComment[]>([])
  const [subtasks,   setSubtasks]   = useState<Todo[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page,       setPage]       = useState(1)
  const [loading,    setLoading]    = useState(true)
  const [newContent, setNewContent] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [editContent,setEditContent]= useState("")
  const [editingGenesis,   setEditingGenesis]   = useState(false)
  const [genesisEditContent, setGenesisEditContent] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [composeMode, setComposeMode] = useState<ComposeMode>("text")
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  // Pinned Author's Note: condensed sticky header is shown once the full card scrolls away.
  const [genesisOutOfView, setGenesisOutOfView] = useState(false)
  const [genesisHighlight,  setGenesisHighlight]  = useState(false)
  // Which task action (if any) is currently awaiting its async handler.
  const [actionPending, setActionPending] = useState<null | "work" | "complete">(null)
  // Per-subtask in-flight guard so double-clicks can't race (and polling won't clobber optimism).
  const [subtaskPending, setSubtaskPending] = useState<Set<string>>(new Set())

  const feedRef           = useRef<HTMLDivElement>(null)
  const composeRef        = useRef<HTMLTextAreaElement>(null)
  const genesisEditRef    = useRef<HTMLTextAreaElement>(null)
  const genesisCardRef    = useRef<HTMLDivElement>(null)
  const plusBtnRef        = useRef<HTMLButtonElement>(null)
  const plusMenuRef       = useRef<HTMLDivElement>(null)
  const highlightTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  // After a full (replace) load, pin the view to the newest message at the bottom.
  const pinBottomRef      = useRef(false)
  // Total comment count, mirrored in a ref so polling can target the last page without re-creating the timer.
  const totalCountRef     = useRef(0)
  // Subtasks currently mid-write — polling must not revert their optimistic state.
  const subtaskPendingRef = useRef<Set<string>>(new Set())
  // System-comment ids hidden client-side after a subtask delete, until the async cascade lands —
  // keeps the deleted subtask's announcement(s) from flickering back via polling/reloads.
  const suppressedCommentIds = useRef<Set<string>>(new Set())
  // Pending post-action catch-up reloads (the status system-comment is produced asynchronously).
  const retryTimers       = useRef<ReturnType<typeof setTimeout>[]>([])

  const setSubtaskBusy = (id: string, on: boolean) => {
    setSubtaskPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(id); else next.delete(id)
      subtaskPendingRef.current = next
      return next
    })
  }

  const load = useCallback(async (pageNum: number, replace: boolean, pin: boolean = replace) => {
    try {
      const res  = await fetchComments(todoId, pageNum, 50)
      const items = (res.items ?? []).filter((c) => !suppressedCommentIds.current.has(c.id))
      setTotalCount(res.totalCount ?? 0)
      totalCountRef.current = res.totalCount ?? 0
      setComments((prev) => (replace ? items : [...items, ...prev]))
      if (pin) pinBottomRef.current = true
    } catch {
      /* silent */
    } finally {
      setLoading(false)
    }
  }, [todoId])

  // Fetch the parent's subtasks and merge by id, so server truth flows in (other users' edits,
  // completions, the inherited category) without flickering away an in-flight optimistic change.
  const loadSubtasks = useCallback(async () => {
    try {
      const list = await fetchSubtasks(todoId)
      setSubtasks((prev) => {
        const pending = subtaskPendingRef.current
        const prevById = new Map(prev.map((s) => [s.id, s]))
        const byId = new Map<string, Todo>()
        let changed = false
        for (const s of list) {
          const existing = prevById.get(s.id)
          // Keep the optimistic copy for rows we're still writing.
          if (existing && pending.has(s.id)) { byId.set(s.id, existing); continue }
          if (!existing || existing.status !== s.status || existing.title !== s.title) changed = true
          byId.set(s.id, s)
        }
        // Preserve optimistic-only rows the server hasn't returned yet (just-created).
        for (const s of prev) {
          if (!byId.has(s.id) && pending.has(s.id)) byId.set(s.id, s)
          else if (!byId.has(s.id) && !list.some((l) => l.id === s.id)) changed = true
        }
        if (!changed && byId.size === prev.length) return prev
        return Array.from(byId.values()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      })
    } catch {
      /* a missing/forbidden parent simply yields no subtasks */
    }
  }, [todoId])

  const isAtBottom = () => {
    const el = feedRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  // Live-merge the newest page into the feed without disrupting the reader's scroll position.
  // Adds comments the client hasn't seen yet (new messages, the async status system-comment) and
  // refreshes any whose content/edit-time changed — picked up by polling and post-action retries,
  // so other users' activity appears without re-opening the modal.
  const mergeLatest = useCallback(async () => {
    try {
      const size = 50
      const lastPage = Math.max(1, Math.ceil((totalCountRef.current || 0) / size))
      const res = await fetchComments(todoId, lastPage, size)
      const items = res.items ?? []
      setTotalCount(res.totalCount ?? 0)
      totalCountRef.current = res.totalCount ?? 0

      const stickToBottom = isAtBottom()
      setComments((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]))
        let changed = false
        for (const c of items) {
          // A subtask just deleted client-side: keep its announcement hidden until the cascade lands.
          if (suppressedCommentIds.current.has(c.id)) { if (byId.delete(c.id)) changed = true; continue }
          const existing = byId.get(c.id)
          if (!existing) { byId.set(c.id, c); changed = true }
          else if (existing.content !== c.content || existing.updatedAt !== c.updatedAt) {
            byId.set(c.id, c); changed = true
          }
        }
        if (!changed) return prev
        // Only re-pin to the bottom when the reader was already there and new content arrived.
        if (stickToBottom) pinBottomRef.current = true
        return Array.from(byId.values()).sort((a, b) =>
          a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
        )
      })
    } catch {
      /* silent — polling is best-effort */
    }
  }, [todoId])

  useEffect(() => { load(1, true); void loadSubtasks() }, [load, loadSubtasks, refreshKey])

  // After an action bumps refreshKey, the resulting status system-comment is materialised
  // asynchronously (Outbox → Inbox). Schedule a few short catch-up merges so it appears within
  // ~1–2s without the user re-opening the modal. Subtasks are pulled on the same cadence so a
  // freshly-created card snaps in beneath its announcement.
  useEffect(() => {
    if (refreshKey === undefined) return
    retryTimers.current.forEach(clearTimeout)
    retryTimers.current = [250, 600, 1100, 1800, 2800, 4200, 5600]
      .map((ms) => setTimeout(() => { void mergeLatest(); void loadSubtasks() }, ms))
    return () => { retryTimers.current.forEach(clearTimeout); retryTimers.current = [] }
  }, [refreshKey, mergeLatest, loadSubtasks])

  // Gentle live polling while the branch is open — picks up other participants' messages/edits and
  // subtask changes. Paused while the viewer is editing so a refresh never clobbers a draft.
  useEffect(() => {
    if (editingId || editingGenesis) return
    const id = setInterval(() => { void mergeLatest(); void loadSubtasks() }, 5000)
    return () => clearInterval(id)
  }, [mergeLatest, loadSubtasks, editingId, editingGenesis])

  const genesis = comments.find((c) => c.isGenesisComment) ?? null
  const stream  = comments.filter((c) => !c.isGenesisComment)
  const hasMore = stream.length < (totalCount - (genesis ? 1 : 0))

  const scrollToBottom = () => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }

  // Honour a pending pin-to-bottom request once the new content has laid out. The programmatic
  // scrollTop change fires onScroll, which re-evaluates the condensed-note visibility.
  useEffect(() => {
    if (!pinBottomRef.current) return
    pinBottomRef.current = false
    const id = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, subtasks])

  // ── Pinned Author's Note: show the condensed header once the full card scrolls past the top ──
  const updateGenesisVisibility = useCallback(() => {
    const scroller = feedRef.current
    const card     = genesisCardRef.current
    if (!scroller || !card) {
      setGenesisOutOfView(false)
      return
    }
    // Reveal the condensed bar when all but the last ~24px of the card has scrolled away.
    const threshold = card.offsetTop + card.offsetHeight - 24
    setGenesisOutOfView(scroller.scrollTop > threshold)
  }, [])

  // Re-evaluate visibility whenever the feed (re)loads or the note appears/disappears.
  useEffect(() => {
    const id = requestAnimationFrame(updateGenesisVisibility)
    return () => cancelAnimationFrame(id)
  }, [updateGenesisVisibility, loading, comments.length, editingGenesis])

  // Smoothly travel back up the branch to the full note and give it a brief highlight.
  const scrollToGenesis = useCallback(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" })
    setGenesisHighlight(false)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    // Defer the pulse a touch so it lands as the card settles into view.
    highlightTimer.current = setTimeout(() => {
      setGenesisHighlight(true)
      highlightTimer.current = setTimeout(() => setGenesisHighlight(false), 1100)
    }, 220)
  }, [])

  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current) }, [])

  // Run a compose-panel task action (take/leave/complete) with a pending indicator.
  const runAction = async (kind: "work" | "complete", fn?: () => Promise<void>) => {
    if (!fn || actionPending) return
    setActionPending(kind)
    try {
      await fn()
    } catch (e) {
      setError(getApiErrorMessage(e))
    } finally {
      setActionPending(null)
      setPlusMenuOpen(false)
    }
  }

  const showWorkAction     = !!(inProgress ? onStopWork : onStartWork)
  const showCompleteAction = !!onCompleteTask
  const showDescription    = !!onSaveDescription

  // ── Subtask mutations (live inline in the branch; no separate panel) ──────────────────────────

  // Anyone with access can complete/reopen — it applies globally (server-side, status-based).
  const toggleSubtaskComplete = async (s: Todo) => {
    if (subtaskPendingRef.current.has(s.id)) return
    const nextStatus = isSubtaskDone(s) ? "todo" : "done"
    setSubtaskBusy(s.id, true)
    setSubtasks((prev) => prev.map((it) => it.id === s.id
      ? { ...it, status: nextStatus === "done" ? "Done" : "Todo" } : it))
    try {
      await updateSubtask(s.id, { status: nextStatus })
      // A "completed a subtask" system event is emitted async; pull it in shortly.
      retryTimers.current.push(setTimeout(() => { void mergeLatest() }, 600))
    } catch (e) {
      setSubtasks((prev) => prev.map((it) => it.id === s.id ? s : it)) // revert
      setError(getApiErrorMessage(e))
    } finally {
      setSubtaskBusy(s.id, false)
    }
  }

  // Take a subtask into work / step back out. Like completion, this is GLOBAL: anyone with access
  // can do it (the server allows any participant to set a subtask's status), and every viewer then
  // sees the in-progress indicator on the subtask. No one is named.
  const toggleSubtaskWork = async (s: Todo) => {
    if (subtaskPendingRef.current.has(s.id)) return
    const nextStatus = isSubtaskWorking(s) ? "todo" : "inprogress"
    setSubtaskBusy(s.id, true)
    setSubtasks((prev) => prev.map((it) => it.id === s.id
      ? { ...it, status: nextStatus === "inprogress" ? "InProgress" : "Todo" } : it))
    try {
      await updateSubtask(s.id, { status: nextStatus })
    } catch (e) {
      setSubtasks((prev) => prev.map((it) => it.id === s.id ? s : it))
      setError(getApiErrorMessage(e))
    } finally {
      setSubtaskBusy(s.id, false)
    }
  }

  // Owner-only: rename a subtask (priority is intentionally not part of the subtask UX).
  const saveSubtaskTitle = async (id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    const snapshot = subtasks
    setSubtasks((prev) => prev.map((it) => it.id === id ? { ...it, title: trimmed } : it))
    try {
      await updateSubtask(id, { title: trimmed })
    } catch (e) {
      setSubtasks(snapshot)
      setError(getApiErrorMessage(e))
    }
  }

  const removeSubtask = async (s: Todo) => {
    if (!isOwner || subtaskPendingRef.current.has(s.id)) return
    setSubtaskBusy(s.id, true)
    const subtasksSnapshot = subtasks

    // Deleting a subtask also clears the system events it left in the branch ("added a subtask: …",
    // "completed a subtask: …"). Remove them optimistically and suppress their ids so polling can't
    // re-add them before the server-side cascade (SubtaskDeletedIntegrationEvent) completes.
    const suffix = `: ${s.title}`
    const related = comments.filter(
      (c) => c.isSystemComment && /subtask/i.test(c.content) && c.content.trimEnd().endsWith(suffix),
    )
    const relatedIds = new Set(related.map((c) => c.id))

    setSubtasks((prev) => prev.filter((it) => it.id !== s.id)) // optimistic (animates out)
    if (relatedIds.size) {
      related.forEach((c) => suppressedCommentIds.current.add(c.id))
      setComments((prev) => prev.filter((c) => !relatedIds.has(c.id)))
      setTotalCount((n) => Math.max(0, n - relatedIds.size))
    }

    try {
      await deleteSubtask(s.id)
    } catch (e) {
      setSubtasks(subtasksSnapshot)
      if (relatedIds.size) {
        related.forEach((c) => suppressedCommentIds.current.delete(c.id))
        setComments((prev) => [...prev, ...related].sort((a, b) =>
          a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
        setTotalCount((n) => n + relatedIds.size)
      }
      setError(getApiErrorMessage(e))
    } finally {
      setSubtaskBusy(s.id, false)
    }
  }

  const handleEditSave = async (id: string) => {
    const content = editContent.trim()
    if (!content || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const updated = await updateComment(todoId, id, content)
      setComments((prev) => prev.map((c) => (c.id === id ? updated : c)))
      setEditingId(null)
    } catch (e) {
      setError(getApiErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const handleGenesisSave = async () => {
    if (submitting || !onSaveDescription) return
    const content = genesisEditContent.trim()
    setSubmitting(true)
    setError(null)
    try {
      // Persist to the task itself (single source of truth). Empty clears the description.
      // Reload so the pinned note reflects the live task value (synthesised server-side).
      // Keep the view at the top (the note lives there) instead of pinning to the bottom.
      await onSaveDescription(content)
      await load(1, true, false)
      setEditingGenesis(false)
    } catch (e) {
      setError(getApiErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    setError(null)
    try {
      await deleteComment(todoId, id)
      setComments((prev) => prev.filter((c) => c.id !== id))
      setTotalCount((n) => Math.max(0, n - 1))
    } catch (e) {
      setError(getApiErrorMessage(e))
    }
  }

  const handleLoadMore = async () => {
    const next = page + 1
    setPage(next)
    await load(next, false)
  }

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    el.style.height = el.scrollHeight + "px"
  }

  // Auto-size the genesis textarea to its full content height when editing opens
  useEffect(() => {
    if (!editingGenesis || !genesisEditRef.current) return
    const el = genesisEditRef.current
    el.style.height = "auto"
    el.style.height = el.scrollHeight + "px"
    el.focus()
  }, [editingGenesis])

  // Close plus menu on outside click
  useEffect(() => {
    if (!plusMenuOpen) return
    const handle = (e: MouseEvent) => {
      if (
        plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node) &&
        plusBtnRef.current  && !plusBtnRef.current.contains(e.target as Node)
      ) {
        setPlusMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [plusMenuOpen])

  const enterComposeMode = (mode: ComposeMode) => {
    setComposeMode(mode)
    setNewContent("")
    setPlusMenuOpen(false)
    if (composeRef.current) composeRef.current.style.height = "auto"
    setTimeout(() => composeRef.current?.focus(), 50)
  }

  const exitComposeMode = () => {
    setComposeMode("text")
    setNewContent("")
    if (composeRef.current) composeRef.current.style.height = "auto"
  }

  const handleSubmitWithMode = async () => {
    const content = newContent.trim()
    if (!content || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (composeMode === "description") {
        // The description lives on the task; persist it there and reload the synthesised note.
        // Keep the view at the top so the freshly-added Author's Note is in sight.
        if (onSaveDescription) {
          await onSaveDescription(content)
          await load(1, true, false)
        }
        setComposeMode("text")
        setNewContent("")
      } else if (composeMode === "subtask") {
        // Subtasks are authored exactly like the description: from the same field. No priority.
        const created = await createSubtask(todoId, { title: content })
        setSubtasks((prev) => [...prev, created])
        setNewContent("")
        // Creating a subtask closes the subtask composer and returns to plain-message mode.
        setComposeMode("text")
        // The "added a subtask" announcement is emitted async — pull it in so the card anchors
        // beneath it.
        retryTimers.current.push(
          setTimeout(() => { void mergeLatest() }, 350),
          setTimeout(() => { void mergeLatest() }, 1000),
          setTimeout(() => { void mergeLatest() }, 2000),
        )
        setTimeout(scrollToBottom, 60)
      } else {
        const c = await addComment(todoId, content)
        setComments((prev) => [...prev, c])
        setTotalCount((n) => n + 1)
        setNewContent("")
        setTimeout(scrollToBottom, 40)
      }
      if (composeRef.current) composeRef.current.style.height = "auto"
    } catch (e) {
      setError(getApiErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const feed = buildFeed(stream, subtasks)

  const composeAccent = composeMode === "text" ? "#0a0a0a" : "#4f46e5"

  // Once the task is completed the "+" menu offers nothing for now — no description, no subtask,
  // and no take/complete actions — so the menu simply doesn't open on a done task.
  const menuShowsDescription = showDescription && !isCompleted
  const menuShowsSubtask     = isOwner && !isCompleted
  const menuShowsActions     = (showWorkAction || showCompleteAction) && !isCompleted
  const hasMenuItems         = menuShowsDescription || menuShowsSubtask || menuShowsActions

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%", minHeight: 0 }}>

      {/* ── Feed area (relative anchor for the condensed sticky note) ── */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>

        {/* Condensed Author's Note — slides in once the full card scrolls away */}
        <AnimatePresence>
          {genesis && genesisOutOfView && !editingGenesis && (
            <motion.button
              type="button"
              onClick={scrollToGenesis}
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={SPRING_STANDARD}
              aria-label="Scroll up to the author's note"
              style={{
                // Floating rounded pill (all corners), inset slightly from the edges so it reads
                // as a tidy chip rather than a flush header with sharp bottom corners.
                position: "absolute",
                top: 6,
                left: 6,
                right: 6,
                zIndex: 6,
                display: "flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
                cursor: "pointer",
                padding: "10px 14px",
                border: "1px solid #ececec",
                borderRadius: 14,
                background: "rgba(250,250,250,0.85)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                boxShadow: "0 10px 24px -12px rgba(0,0,0,0.30)",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,243,255,0.9)" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(250,250,250,0.82)" }}
            >
              <FriendAvatar
                friend={{
                  id: genesis.authorId,
                  firstName: genesis.authorName?.split(" ")[0],
                  lastName: genesis.authorName?.split(" ")[1],
                  profilePictureUrl: genesis.authorAvatarUrl,
                }}
                size={22}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a3a3a3", lineHeight: 1.2 }}>
                  Author&apos;s Note
                </div>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: "#262626", lineHeight: 1.3,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1,
                }}>
                  {genesis.content}
                </div>
              </div>
              <motion.div
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: 7,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "#f0f0f0", color: "#8b5cf6",
                }}
              >
                <ChevronUp size={13} strokeWidth={2.4} />
              </motion.div>
            </motion.button>
          )}
        </AnimatePresence>

        {/* ── Timeline rail (scrolls; the pinned note lives at its top and scrolls away) ── */}
        <div
          ref={feedRef}
          className="branch-scroll"
          onScroll={updateGenesisVisibility}
          style={{
            position: "relative",
            paddingLeft: 6,
            paddingRight: 4,
            paddingTop: 4,
            paddingBottom: 4,
            height: "100%",
            overflowY: "auto",
          }}
        >

      {/* ── Pinned author card (a distinct header; the activity rail begins below it) ── */}
      {!loading && genesis && (
        <div
          ref={genesisCardRef}
          style={{
            position: "relative",
            zIndex: 1,
            background: "#fafafa",
            border: "1px solid #f0f0f0",
            borderRadius: 18,
            padding: "16px 18px 18px",
            marginLeft: -6,
            marginRight: -4,
            marginBottom: 14,
            animation: genesisHighlight ? "genesis_highlight 1100ms ease-out" : undefined,
          }}
        >
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <FriendAvatar
                friend={{
                  id: genesis.authorId,
                  firstName: genesis.authorName?.split(" ")[0],
                  lastName: genesis.authorName?.split(" ")[1],
                  profilePictureUrl: genesis.authorAvatarUrl,
                }}
                size={32}
              />
              <div>
                <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a3a3a3", lineHeight: 1.2 }}>
                  Author&apos;s Note
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 900, letterSpacing: "-0.015em", color: "#0a0a0a" }}>
                    {genesis.authorName}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#a3a3a3" }}>
                    {formatTimeHHMM(genesis.createdAt)}
                  </span>
                </div>
              </div>
            </div>

            {/* Edit button — owner only */}
            {isOwner && !editingGenesis && (
              <button
                onClick={() => { setEditingGenesis(true); setGenesisEditContent(genesis.content) }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "white", border: "1px solid #eaeaea",
                  borderRadius: 8, padding: "5px 10px", cursor: "pointer",
                  fontSize: 10, fontWeight: 800, letterSpacing: "0.04em",
                  textTransform: "uppercase", color: "#525252",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "white" }}
              >
                <Pencil size={10} />
                Edit
              </button>
            )}
          </div>

          {/* Body */}
          {editingGenesis ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                ref={genesisEditRef}
                value={genesisEditContent}
                onChange={(e) => {
                  setGenesisEditContent(e.target.value)
                  e.target.style.height = "auto"
                  e.target.style.height = e.target.scrollHeight + "px"
                }}
                maxLength={GENESIS_MAX}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleGenesisSave()
                  if (e.key === "Escape") setEditingGenesis(false)
                }}
                style={{
                  width: "100%", background: "white", border: "1px solid #eaeaea", borderRadius: 12,
                  padding: 12, fontSize: 13, lineHeight: 1.6, resize: "none",
                  fontFamily: "inherit", color: "#262626", outline: "none", boxSizing: "border-box",
                  minHeight: 60, overflowY: "hidden",
                }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setEditingGenesis(false)}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    fontSize: 11, fontWeight: 800, color: "#525252",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenesisSave}
                  disabled={submitting}
                  style={{
                    background: "#0a0a0a", border: "none", borderRadius: 9,
                    padding: "6px 12px", cursor: "pointer",
                    fontSize: 11, fontWeight: 800, letterSpacing: "0.04em",
                    textTransform: "uppercase", color: "white",
                  }}
                >
                  {submitting ? "…" : genesisEditContent.trim() ? "Save" : "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <p style={{
              fontSize: 13.5, fontWeight: 500, lineHeight: 1.65, color: "#262626",
              whiteSpace: "pre-wrap", letterSpacing: "-0.005em", margin: 0,
              overflowWrap: "anywhere", wordBreak: "break-word",
            }}>
              {genesis.content}
            </p>
          )}
        </div>
      )}

        {/* Load earlier */}
        {hasMore && !loading && (
          <button
            onClick={handleLoadMore}
            style={{
              display: "block", marginBottom: 10,
              background: "none", border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 800, letterSpacing: "0.04em",
              textTransform: "uppercase", color: "#0a0a0a",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecoration = "underline" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecoration = "none" }}
          >
            Load earlier messages
          </button>
        )}

        {loading && (
          <p style={{ fontSize: 12, color: "#a3a3a3" }}>Loading…</p>
        )}

        {!loading && feed.length === 0 && (
          <p style={{ fontSize: 12, color: "#a3a3a3", fontStyle: "italic" }}>
            No messages yet
          </p>
        )}

        {/* ── Activity rail ── A single relative wrapper whose height equals its content, so the
            timeline line spans every item without breaking when the feed grows and scrolls. */}
        {feed.length > 0 && (
          <div style={{ position: "relative", paddingLeft: RAIL_GUTTER }}>
            {/* Continuous rail line — gradient fades softly at both ends. */}
            <div style={{
              position: "absolute",
              left: RAIL_CENTER - 1,
              top: 4,
              bottom: 4,
              width: 2,
              borderRadius: 1,
              background: "linear-gradient(to bottom, transparent 0, #e4e4e7 14px, #e4e4e7 calc(100% - 14px), transparent 100%)",
              pointerEvents: "none",
            }} />

            <AnimatePresence initial={false}>
              {feed.map((item) => {
                if (item.type === "separator") {
                  return <DaySeparator key={item.key} label={item.label} />
                }
                if (item.type === "subtask") {
                  const s = item.subtask
                  return (
                    <SubtaskCard
                      key={`sub-${s.id}`}
                      subtask={s}
                      meta={item.meta}
                      isOwner={isOwner}
                      done={isSubtaskDone(s)}
                      working={isSubtaskWorking(s)}
                      pending={subtaskPending.has(s.id)}
                      onToggleComplete={() => toggleSubtaskComplete(s)}
                      onToggleWork={() => toggleSubtaskWork(s)}
                      onDelete={() => removeSubtask(s)}
                      onSaveTitle={(title) => saveSubtaskTitle(s.id, title)}
                    />
                  )
                }
                const c = item.comment
                if (c.isSystemComment) {
                  return <SystemEvent key={c.id} comment={c} />
                }
                return (
                  <MessageItem
                    key={c.id}
                    comment={c}
                    isOwner={isOwner}
                    editingId={editingId}
                    editContent={editContent}
                    submitting={submitting}
                    onEditStart={(id, content) => { setEditingId(id); setEditContent(content) }}
                    onEditCancel={() => setEditingId(null)}
                    onEditSave={handleEditSave}
                    onEditContentChange={setEditContent}
                    onDelete={handleDelete}
                  />
                )
              })}
            </AnimatePresence>
          </div>
        )}
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 11, color: "#ef4444", padding: "4px 0" }}>{error}</p>
      )}

      {/* ── Compose ── */}
      <div style={{ position: "relative", marginTop: 8 }}>

        {/* Mode chip — slides in above compose box when authoring the description or a subtask */}
        {composeMode !== "text" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            marginBottom: 6,
            animation: "chip_enter 180ms cubic-bezier(0.16,1,0.3,1) both",
          }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "#eef2ff", border: "1px solid #c7d2fe",
              borderRadius: 8, padding: "4px 8px 4px 7px",
            }}>
              {composeMode === "description"
                ? <FileText size={11} color="#4f46e5" strokeWidth={2.2} />
                : <ListTree size={11} color="#4f46e5" strokeWidth={2.2} />}
              <span style={{
                fontSize: 11, fontWeight: 900, letterSpacing: "0.06em",
                textTransform: "uppercase", color: "#4f46e5",
              }}>
                {composeMode === "description" ? "Description" : "Subtask"}
              </span>
              <button
                onClick={exitComposeMode}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 16, height: 16, borderRadius: 4, border: "none",
                  background: "transparent", cursor: "pointer", padding: 0,
                  color: "#6366f1", marginLeft: 1,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#c7d2fe" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                title="Cancel"
              >
                <X size={10} strokeWidth={2.5} />
              </button>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "#a3a3a3" }}>
              {composeMode === "description" ? "task description · ⌘+↵ to send" : "a step in this task · ↵ to add"}
            </span>
          </div>
        )}

        {/* Compose box — position:relative anchors the floating menu */}
        <div style={{
          position: "relative",
          background: composeMode !== "text" ? "#faf5ff" : "#fafafa",
          border: composeMode !== "text" ? "1.5px solid #c7d2fe" : "1px solid #f0f0f0",
          borderRadius: 14,
          padding: 4,
          display: "flex",
          alignItems: "center",
          gap: 4,
          transition: "border-color 200ms, background 200ms",
        }}>

          {/* Attach menu — absolutely above the compose box (empty/closed on a completed task) */}
          {plusMenuOpen && hasMenuItems && (
            <div
              ref={plusMenuRef}
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                left: 0,
                background: "white",
                border: "1px solid #ebebeb",
                borderRadius: 14,
                boxShadow: "0 8px 30px -4px rgba(0,0,0,0.12), 0 2px 8px -2px rgba(0,0,0,0.06)",
                padding: 6,
                minWidth: 200,
                zIndex: 50,
                animation: "pop_in_up 160ms cubic-bezier(0.16,1,0.3,1) both",
              }}
            >
              {/* Author-only: add the task description (disabled once one exists) */}
              {menuShowsDescription && (
                <>
                  <MenuSectionLabel>Attach</MenuSectionLabel>
                  <button
                    onClick={() => { if (!genesis) enterComposeMode("description") }}
                    disabled={!!genesis}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 10px", borderRadius: 10, border: "none",
                      cursor: genesis ? "not-allowed" : "pointer",
                      background: "transparent", textAlign: "left",
                      opacity: genesis ? 0.45 : 1,
                      transition: "background 100ms, opacity 100ms",
                    }}
                    onMouseEnter={(e) => {
                      if (!genesis) (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5"
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "transparent"
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: genesis ? "#f5f5f5" : "#eef2ff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <FileText size={13} color={genesis ? "#a3a3a3" : "#4f46e5"} strokeWidth={1.8} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: genesis ? "#a3a3a3" : "#0a0a0a", letterSpacing: "-0.01em" }}>
                        Description
                      </div>
                      <div style={{ fontSize: 10.5, fontWeight: 500, color: "#a3a3a3", marginTop: 1 }}>
                        {genesis ? "Already added" : "Task description"}
                      </div>
                    </div>
                    {genesis && (
                      <div style={{
                        marginLeft: "auto", fontSize: 9, fontWeight: 900,
                        letterSpacing: "0.1em", textTransform: "uppercase",
                        color: "#c4b5fd", background: "#f5f3ff",
                        padding: "2px 7px", borderRadius: 6,
                      }}>
                        Added
                      </div>
                    )}
                  </button>
                </>
              )}

              {/* Author-only: add a subtask — authored in the same field, appears inline in the branch */}
              {menuShowsSubtask && (
                <>
                  {!menuShowsDescription && <MenuSectionLabel>Attach</MenuSectionLabel>}
                  <button
                    onClick={() => enterComposeMode("subtask")}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 10px", borderRadius: 10, border: "none", cursor: "pointer",
                      background: "transparent", textAlign: "left", transition: "background 100ms",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5" }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <ListTree size={14} color="#4f46e5" strokeWidth={1.9} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0a0a0a", letterSpacing: "-0.01em" }}>
                        Subtask
                      </div>
                      <div style={{ fontSize: 10.5, fontWeight: 500, color: "#a3a3a3", marginTop: 1 }}>
                        Add a step to this task
                      </div>
                    </div>
                  </button>
                </>
              )}

              {/* Task actions — available to everyone (owner & collaborators), hidden once done */}
              {menuShowsActions && (
                <>
                  {menuShowsDescription && (
                    <div style={{ height: 1, background: "#f3f3f3", margin: "6px 8px" }} />
                  )}
                  <MenuSectionLabel>Actions</MenuSectionLabel>

                  {showWorkAction && (
                    inProgress ? (
                      <MenuActionItem
                        icon={<LogOut size={13} color="#dc2626" strokeWidth={1.9} />}
                        iconBg="#fef2f2"
                        title="Leave task"
                        subtitle="Stop working on this"
                        pending={actionPending === "work"}
                        disabled={actionPending !== null}
                        onClick={() => runAction("work", onStopWork)}
                      />
                    ) : (
                      <MenuActionItem
                        icon={<Zap size={13} color="#4f46e5" strokeWidth={1.9} />}
                        iconBg="#eef2ff"
                        title="Take into work"
                        subtitle="Start working on this"
                        pending={actionPending === "work"}
                        disabled={actionPending !== null}
                        onClick={() => runAction("work", onStartWork)}
                      />
                    )
                  )}

                  {showCompleteAction && (
                    <MenuActionItem
                      icon={<CheckCircle2 size={13} color="#059669" strokeWidth={1.9} />}
                      iconBg="#ecfdf5"
                      title={isCompleted ? "Reopen task" : "Complete task"}
                      subtitle={isCompleted ? "Move back to active" : "Mark this task done"}
                      pending={actionPending === "complete"}
                      disabled={actionPending !== null}
                      onClick={() => runAction("complete", onCompleteTask)}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* + button — direct flex child, no wrapper div */}
          <button
            ref={plusBtnRef}
            onClick={() => setPlusMenuOpen((v) => !v)}
            style={{
              width: 32, height: 32, borderRadius: 10, border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", flexShrink: 0,
              background: plusMenuOpen ? "#f0f0f0" : "transparent",
              color: plusMenuOpen ? "#0a0a0a" : "#a3a3a3",
              transition: "background 120ms, color 120ms",
            }}
            onMouseEnter={(e) => {
              if (!plusMenuOpen) {
                (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5"
                ;(e.currentTarget as HTMLButtonElement).style.color = "#525252"
              }
            }}
            onMouseLeave={(e) => {
              if (!plusMenuOpen) {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent"
                ;(e.currentTarget as HTMLButtonElement).style.color = "#a3a3a3"
              }
            }}
            title="Attach"
          >
            <Plus size={16} strokeWidth={2.2} />
          </button>

          <textarea
            ref={composeRef}
            value={newContent}
            onChange={(e) => {
              setNewContent(e.target.value)
              autoResize(e.target)
            }}
            onKeyDown={(e) => {
              // Subtask titles are single-line — plain Enter adds the step. Description/messages
              // use ⌘/Ctrl+Enter so multi-line text can be composed freely.
              if (e.key === "Enter" && composeMode === "subtask" && !e.shiftKey) {
                e.preventDefault()
                handleSubmitWithMode()
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                handleSubmitWithMode()
              }
              if (e.key === "Escape" && composeMode !== "text") {
                exitComposeMode()
              }
            }}
            rows={1}
            placeholder={
              composeMode === "description"
                ? "Enter task description…"
                : composeMode === "subtask"
                  ? "Add a subtask…"
                  : "Write in branch… ⌘+↵ to send"
            }
            maxLength={
              composeMode === "description" ? GENESIS_MAX
                : composeMode === "subtask" ? SUBTASK_MAX
                  : COMMENT_MAX
            }
            disabled={submitting}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              padding: "6px 10px", fontSize: 12.5, fontWeight: 500, lineHeight: 1.5,
              fontFamily: "inherit", color: "#262626",
              resize: "none", maxHeight: 80, overflowY: "auto",
            }}
          />
          <button
            onClick={handleSubmitWithMode}
            disabled={!newContent.trim() || submitting}
            style={{
              width: 32, height: 32, borderRadius: 10, border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: newContent.trim() && !submitting ? "pointer" : "default",
              background: newContent.trim() && !submitting ? composeAccent : "#e5e5e5",
              flexShrink: 0,
              transition: "background 120ms",
            }}
          >
            {submitting && composeMode === "subtask"
              ? <Loader2 size={14} color="white" className="animate-spin" />
              : <Send size={14} color={newContent.trim() && !submitting ? "white" : "#a3a3a3"} />}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Compose "+" menu helpers ── */
function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 900, letterSpacing: "0.14em",
      textTransform: "uppercase", color: "#a3a3a3",
      padding: "4px 10px 8px",
    }}>
      {children}
    </div>
  )
}

interface MenuActionItemProps {
  icon: ReactNode
  iconBg: string
  title: string
  subtitle: string
  pending?: boolean
  disabled?: boolean
  onClick: () => void
}

function MenuActionItem({ icon, iconBg, title, subtitle, pending, disabled, onClick }: MenuActionItemProps) {
  const muted = disabled && !pending
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "8px 10px", borderRadius: 10, border: "none",
        cursor: disabled ? "default" : "pointer",
        background: "transparent", textAlign: "left",
        opacity: muted ? 0.45 : 1,
        transition: "background 100ms, opacity 100ms",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5" }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: iconBg,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0a0a0a", letterSpacing: "-0.01em" }}>
          {title}
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 500, color: "#a3a3a3", marginTop: 1 }}>
          {subtitle}
        </div>
      </div>
      {pending && (
        <Loader2 size={14} color="#a3a3a3" className="animate-spin" style={{ marginLeft: "auto", flexShrink: 0 }} />
      )}
    </button>
  )
}

/* ── Day separator ── */
function DaySeparator({ label }: { label: string }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", padding: "10px 0 6px", marginLeft: -RAIL_GUTTER, zIndex: 1 }}>
      <span style={{
        background: "white",
        border: "1px solid #eaeaea",
        borderRadius: 100,
        padding: "2px 10px",
        fontSize: 9,
        fontWeight: 900,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "#525252",
        whiteSpace: "nowrap",
        flexShrink: 0,
        position: "relative",
        zIndex: 1,
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: "#f5f5f5", marginLeft: 8 }} />
    </div>
  )
}

/* ── System event ── */
const SYSTEM_MARKER = 22
function SystemEvent({ comment }: { comment: TodoComment }) {
  const Icon = getSystemEventIcon(comment.content)
  // System comments carry no stored author name (the name is inline in the sentence), so render
  // the sentence as-is and bold the leading name when one is present.
  const author = comment.authorName?.trim()
  const body = author
    ? comment.content.replace(new RegExp("^" + author + "\\s*"), "")
    : comment.content

  return (
    <div style={{ position: "relative", padding: "6px 0", minHeight: SYSTEM_MARKER + 8 }}>
      {/* Marker — centred on the rail, tinted to the event type */}
      <div style={{
        position: "absolute",
        left: RAIL_CENTER - RAIL_GUTTER - SYSTEM_MARKER / 2,
        top: 2,
        width: SYSTEM_MARKER,
        height: SYSTEM_MARKER,
        borderRadius: "50%",
        background: "#ffffff",
        boxShadow: "0 0 0 3px #ffffff, inset 0 0 0 1.5px #e5e5e5",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
      }}>
        <Icon size={11} color="#737373" strokeWidth={2.2} />
      </div>

      {/* Text row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: SYSTEM_MARKER }}>
        <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 12, fontWeight: 600, color: "#525252", lineHeight: 1.35, overflowWrap: "anywhere", wordBreak: "break-word" }}>
          {author && (
            <strong style={{ fontWeight: 900, color: "#0a0a0a" }}>{author} </strong>
          )}
          {body}
        </p>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#a3a3a3", flexShrink: 0 }}>
          {formatTimeHHMM(comment.createdAt)}
        </span>
      </div>
    </div>
  )
}

/* ── Subtask cluster ── one integrated thread on the rail: a minimal "added a subtask" caption,
   the card itself (with an all-viewers "In progress" indicator), and — when done — a compact
   completion "reply" the rail gently bends down to. The card's completion toggle is the primary
   rail marker; the green completion node sits just below it. The subtask's create/complete system
   comments are folded in here (parsed into `meta`) instead of appearing as separate rail nodes. */
const SUBTASK_TOGGLE = 26
const SUBTASK_DELETE_ZONE = 50
// x of the rail centre within a cluster's content box (content starts RAIL_GUTTER from the wrapper).
const RAIL_X = RAIL_CENTER - RAIL_GUTTER
// A subtask branches off the main rail into its own little sub-branch: the card + its completion
// reply sit offset to the side (SUBTASK_OFFSET), joined back to the rail by connectors. The ONLY
// marker is the subtask's completion toggle, which lives on the sub-branch (SUB_TOGGLE_X) — the
// completion reply is just another (icon-less) reply on that sub-branch.
const SUBTASK_OFFSET = 28    // card / reply content left edge (the sub-branch column)
const SUB_TOGGLE_X = 4       // the toggle's centre x — the subtask's sole marker, on the sub-branch
interface SubtaskCardProps {
  subtask: Todo
  meta: SubtaskMeta
  isOwner: boolean
  done: boolean
  working: boolean
  pending: boolean
  onToggleComplete: () => void
  onToggleWork: () => void
  onDelete: () => void
  onSaveTitle: (title: string) => void
}

function SubtaskCard({
  subtask, meta, isOwner, done, working, pending,
  onToggleComplete, onToggleWork, onDelete, onSaveTitle,
}: SubtaskCardProps) {
  const [hovered, setHovered] = useState(false)
  const [deleteHovered, setDeleteHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(subtask.title)
  const editInputRef = useRef<HTMLTextAreaElement>(null)

  const beginEdit = () => {
    if (!isOwner) return
    setEditTitle(subtask.title)
    setEditing(true)
    setTimeout(() => {
      const el = editInputRef.current
      if (!el) return
      el.focus(); el.select()
      el.style.height = "auto"
      el.style.height = el.scrollHeight + "px"
    }, 40)
  }
  const commitEdit = () => {
    const t = editTitle.trim()
    if (t && t !== subtask.title) onSaveTitle(t)
    setEditing(false)
  }

  // Owner gets the slide-out delete affordance, so reserve the strip's width on the right.
  const bodyPaddingRight = isOwner && !editing ? SUBTASK_DELETE_ZONE - 2 : 12

  const completedName = meta.completedBy?.trim()
  const completedAt = meta.completedAt
  // Sub-branch accent — the little branch the subtask hangs from, tinted to its state.
  const branchColor = done ? "#a7f3d0" : working ? "#fcd98c" : "#e1e1e6"

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, height: 0, marginTop: -2, marginBottom: 0 }}
      transition={SPRING_SNAP}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setDeleteHovered(false) }}
      style={{ position: "relative", padding: "6px 0" }}
    >
      {/* ── Card row ── the subtask forks off the main rail into its own sub-branch. The completion
          toggle is the subtask's ONLY marker, sitting on the sub-branch at the card's VERTICAL
          CENTRE; a fork connector reaches in from the main rail, and (when done) the sub-branch
          continues downward to the completion reply. */}
      <div style={{ position: "relative", paddingLeft: SUBTASK_OFFSET }}>
        {/* Fork — main rail → the sub-branch toggle */}
        <span style={{
          position: "absolute", left: RAIL_X, top: "50%", transform: "translateY(-50%)",
          width: SUB_TOGGLE_X - RAIL_X, height: 2, borderRadius: 1,
          background: branchColor, transition: "background 200ms",
        }} />
        {/* Stem — toggle → the offset card */}
        <span style={{
          position: "absolute", left: SUB_TOGGLE_X, top: "50%", transform: "translateY(-50%)",
          width: SUBTASK_OFFSET - SUB_TOGGLE_X, height: 2, borderRadius: 1,
          background: branchColor, transition: "background 200ms",
        }} />
        {/* Sub-branch continuation downward to the completion reply (only when done) */}
        {done && (
          <span style={{
            position: "absolute", left: SUB_TOGGLE_X - 1, top: "50%", bottom: -6, width: 2,
            background: branchColor, transition: "background 200ms",
          }} />
        )}
        {/* Completion toggle — the subtask's sole marker, on the sub-branch, vertically centred */}
        <button
          onClick={onToggleComplete}
          disabled={pending}
          aria-label={done ? "Mark subtask not done" : "Complete subtask"}
          style={{
            position: "absolute",
            left: SUB_TOGGLE_X - SUBTASK_TOGGLE / 2,
            top: "50%",
            width: SUBTASK_TOGGLE, height: SUBTASK_TOGGLE, borderRadius: "50%",
            border: done ? "none" : `2px solid ${working ? "#f59e0b" : "#d4d4d4"}`,
            background: done ? "#10b981" : "#ffffff",
            boxShadow: done
              ? "0 0 0 3px #ffffff, 0 2px 6px -1px rgba(16,185,129,0.5)"
              : "0 0 0 3px #ffffff",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: pending ? "default" : "pointer", padding: 0, zIndex: 3,
            transition: "background 160ms, border-color 160ms, transform 120ms, box-shadow 160ms",
            transform: `translateY(-50%) scale(${hovered && !done ? 1.12 : 1})`,
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {done ? (
              <motion.span key="done" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
                <Check size={15} color="white" strokeWidth={3} />
              </motion.span>
            ) : working ? (
              <motion.span key="work" initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ display: "flex" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} className="animate-pulse" />
              </motion.span>
            ) : hovered ? (
              <motion.span key="hover" initial={{ scale: 0 }} animate={{ scale: 1 }}>
                <Check size={14} color="#10b981" strokeWidth={3} />
              </motion.span>
            ) : null}
          </AnimatePresence>
        </button>

        {/* Card body — taller, task-like; overflow:hidden clips the delete strip + rounded corners.
            alignItems:flex-start lets the card grow downward when a long title wraps. */}
        <div style={{
          position: "relative", overflow: "hidden",
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "11px 12px", paddingRight: bodyPaddingRight,
          borderRadius: 12,
          background: done ? "#f7fdfb" : working ? "#fffdf5" : "#fafafa",
          border: `1px solid ${done ? "#d7f5ea" : working && !done ? "#fde68a" : "#f0f0f0"}`,
          transition: "background 200ms, border-color 200ms, padding 160ms",
        }}>
          {/* Title (wraps freely) or inline editor */}
          {editing ? (
            <textarea
              ref={editInputRef}
              value={editTitle}
              onChange={(e) => {
                setEditTitle(e.target.value)
                e.target.style.height = "auto"
                e.target.style.height = e.target.scrollHeight + "px"
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitEdit() }
                if (e.key === "Escape") setEditing(false)
              }}
              onBlur={commitEdit}
              maxLength={SUBTASK_MAX}
              rows={1}
              style={{
                flex: 1, minWidth: 0, background: "white",
                border: "1.5px solid #c7d2fe", borderRadius: 8, outline: "none",
                padding: "7px 10px", fontSize: 13.5, fontWeight: 400, lineHeight: 1.4,
                color: "#262626", fontFamily: "inherit", resize: "none",
                maxHeight: 160, overflowY: "auto",
              }}
            />
          ) : (
            <span
              onDoubleClick={beginEdit}
              title={isOwner ? "Double-click to edit" : undefined}
              style={{
                flex: 1, minWidth: 0,
                // Non-bold so it reads as a plain branch step; wraps so a long step grows the card.
                fontSize: 13.5, fontWeight: 400, lineHeight: 1.45, paddingTop: 4,
                color: done ? "#a3a3a3" : "#262626",
                textDecoration: done ? "line-through" : "none",
                overflowWrap: "anywhere", wordBreak: "break-word",
                cursor: isOwner ? "text" : "default",
                transition: "color 200ms",
              }}
            >
              {subtask.title}
            </span>
          )}

          {/* In-progress indicator — a soft "someone is on it" presence badge shown to EVERY viewer
              (it never names who). Anyone can put a subtask into work, and all viewers see this. */}
          <AnimatePresence initial={false}>
            {working && !done && !editing && (
              <motion.span
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ type: "spring", stiffness: 480, damping: 26 }}
                title="Someone is working on this"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, marginTop: 2,
                  fontSize: 9.5, fontWeight: 900, letterSpacing: "0.07em", textTransform: "uppercase",
                  color: "#b45309",
                  background: "linear-gradient(180deg,#fff8e6,#fef0c7)",
                  border: "1px solid #fce4a6",
                  padding: "3px 9px 3px 7px", borderRadius: 999,
                  boxShadow: "0 1px 3px -1px rgba(245,158,11,0.35)",
                }}
              >
                <span style={{ position: "relative", width: 7, height: 7, flexShrink: 0 }}>
                  <span className="animate-ping" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#f59e0b", opacity: 0.6 }} />
                  <span style={{ position: "absolute", inset: 1, borderRadius: "50%", background: "#f59e0b" }} />
                </span>
                In progress
              </motion.span>
            )}
          </AnimatePresence>

          {/* Inline actions — revealed on hover, hidden under the delete panel. "Take into work" is
              available to EVERYONE (global, like completion); editing stays owner-only. */}
          {!editing && (isOwner || !done) && (
            <div style={{
              display: "flex", alignItems: "center", gap: 2, flexShrink: 0, marginTop: 1,
              opacity: hovered && !deleteHovered ? 1 : 0, transition: "opacity 140ms",
              pointerEvents: hovered && !deleteHovered ? "auto" : "none",
            }}>
              {isOwner && (
                <SubtaskIconButton label="Edit subtask" title="Edit" color="#525252" hoverBg="#f0f0f0" onClick={beginEdit} disabled={pending}>
                  <Pencil size={13} strokeWidth={2} />
                </SubtaskIconButton>
              )}
              {!done && (
                <SubtaskIconButton
                  label={working ? "Stop working on subtask" : "Take subtask into work"}
                  title={working ? "Step out" : "Take into work"}
                  color={working ? "#b45309" : "#6366f1"} hoverBg="#f0f0f0"
                  onClick={onToggleWork} disabled={pending}
                >
                  {working ? <Pause size={14} strokeWidth={2} /> : <Zap size={14} strokeWidth={2} />}
                </SubtaskIconButton>
              )}
            </div>
          )}

          {/* Delete strip — slides in from the right, identical in feel to a task card's delete panel */}
          {isOwner && !editing && (
            <div
              onMouseEnter={() => setDeleteHovered(true)}
              onMouseLeave={() => setDeleteHovered(false)}
              style={{
                position: "absolute", top: 0, right: 0, bottom: 0,
                width: SUBTASK_DELETE_ZONE, zIndex: 2,
                display: "flex", alignItems: "center", justifyContent: "center",
                overflow: "hidden", cursor: pending ? "default" : "pointer",
              }}
            >
              <AnimatePresence>
                {deleteHovered && (
                  <motion.button
                    key="sub-delete-panel"
                    type="button"
                    onClick={(e) => { e.stopPropagation(); if (!pending) onDelete() }}
                    disabled={pending}
                    aria-label="Delete subtask"
                    variants={{
                      hidden: { clipPath: "inset(0 0 0 100%)", transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
                      visible: { clipPath: "inset(0 0 0 0%)", transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } },
                    }}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                    whileHover={{ filter: "brightness(1.1)" }}
                    style={{
                      position: "absolute", inset: 0, border: "none", padding: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "white", cursor: pending ? "default" : "pointer",
                      background: "linear-gradient(to right, rgba(239,68,68,0) 0%, rgba(239,68,68,0.85) 38%, #dc2626 100%)",
                      boxShadow: "-6px 0 18px rgba(239,68,68,0.18)",
                    }}
                  >
                    <motion.div
                      variants={{
                        hidden: { scale: 0.5, opacity: 0, y: 6 },
                        visible: { scale: 1, opacity: 1, y: 0, transition: { delay: 0.06, type: "spring", stiffness: 420, damping: 22 } },
                      }}
                      style={{ display: "flex" }}
                    >
                      {pending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} strokeWidth={2.2} />}
                    </motion.div>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* ── Completion reply ── its own green completion node on the rail (vertically centred) with
          an offset note; shown whenever the subtask is done. The name fills in once the folded
          system comment lands, otherwise a nameless "Completed" shows immediately. */}
      <AnimatePresence initial={false}>
        {done && (
          <SubtaskCompletionReply
            key="completion"
            name={completedName}
            at={completedAt}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ── Completion reply ── another reply hanging off the subtask's sub-branch, with NO rail icon.
   A soft "└" elbow continues the sub-branch from the card down into an icon-less note. */
const REPLY_ROW = 26
function SubtaskCompletionReply({ name, at }: { name?: string; at?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={SPRING_SNAP}
      style={{ position: "relative", paddingLeft: SUBTASK_OFFSET, minHeight: REPLY_ROW }}
    >
      {/* "└" elbow — continues the sub-branch down from the card, then curves into the note.
          No node/icon: the completion is just a reply on the sub-branch. */}
      <span style={{
        position: "absolute", left: SUB_TOGGLE_X - 1, top: -8,
        width: SUBTASK_OFFSET - SUB_TOGGLE_X, height: REPLY_ROW / 2 + 8,
        borderLeft: "2px solid #a7f3d0", borderBottom: "2px solid #a7f3d0",
        borderBottomLeftRadius: 12, pointerEvents: "none",
      }} />

      {/* Note (icon-less) */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, minHeight: REPLY_ROW }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: "#6f7d76", lineHeight: 1.3 }}>
          {name
            ? <><strong style={{ color: "#0a0a0a", fontWeight: 800 }}>{name}</strong> completed this</>
            : <strong style={{ color: "#059669", fontWeight: 800 }}>Completed</strong>}
        </span>
        {at && (
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", color: "#bdbdbd" }}>
            {formatTimeHHMM(at)}
          </span>
        )}
      </div>
    </motion.div>
  )
}

interface SubtaskIconButtonProps {
  label: string
  title: string
  color: string
  hoverBg: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}
function SubtaskIconButton({ label, title, color, hoverBg, disabled, onClick, children }: SubtaskIconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      style={{
        width: 26, height: 26, borderRadius: 8, border: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", cursor: disabled ? "default" : "pointer", color,
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = hoverBg }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
    >
      {children}
    </button>
  )
}

/* ── Message item ── */
interface MessageItemProps {
  comment: TodoComment
  isOwner: boolean
  editingId: string | null
  editContent: string
  submitting: boolean
  onEditStart: (id: string, content: string) => void
  onEditCancel: () => void
  onEditSave: (id: string) => void
  onEditContentChange: (v: string) => void
  onDelete: (id: string) => void
}

function MessageItem({
  comment: c, isOwner, editingId, editContent, submitting,
  onEditStart, onEditCancel, onEditSave, onEditContentChange, onDelete,
}: MessageItemProps) {
  const [hovered, setHovered] = useState(false)
  const isEditing = editingId === c.id
  const canAct    = c.isOwn || isOwner

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        padding: "9px 10px 9px 10px",
        margin: "2px 0",
        borderRadius: 12,
        background: hovered ? "#fafafa" : "transparent",
        transition: "background 140ms",
      }}
    >
      {/* Avatar marker — centred on the rail */}
      <div style={{
        position: "absolute",
        left: RAIL_CENTER - RAIL_GUTTER - 26 / 2,
        top: 8,
        zIndex: 2,
      }}>
        <FriendAvatar
          friend={{
            id: c.authorId,
            firstName: c.authorName?.split(" ")[0],
            lastName: c.authorName?.split(" ")[1],
            profilePictureUrl: c.authorAvatarUrl
          }}
          size={26}
          style={{ boxShadow: "0 0 0 3px white" }}
        />
      </div>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 3 }}>
        <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: "-0.01em", color: "#0a0a0a" }}>
          {c.authorName}
        </span>
        {c.isOwn && (
          <span style={{
            background: "#eaeaea", color: "#525252",
            padding: "1px 6px", borderRadius: 5,
            fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            YOU
          </span>
        )}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#a3a3a3" }}>
          {formatTimeHHMM(c.createdAt)}
        </span>
        {c.isEdited && (
          <span style={{ fontSize: 9, color: "#a3a3a3", fontStyle: "italic" }}>edited</span>
        )}

        {/* Hover actions */}
        {hovered && canAct && !isEditing && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
            {c.isOwn && (
              <button
                onClick={() => onEditStart(c.id, c.content)}
                style={{
                  width: 20, height: 20, borderRadius: 5, border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", cursor: "pointer",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#eaeaea" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
              >
                <Pencil size={10} color="#525252" />
              </button>
            )}
            <button
              onClick={() => onDelete(c.id)}
              style={{
                width: 20, height: 20, borderRadius: 5, border: "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#eaeaea" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
            >
              <Trash2 size={10} color="#525252" />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {isEditing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            maxLength={COMMENT_MAX}
            autoFocus
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onEditSave(c.id)
              if (e.key === "Escape") onEditCancel()
            }}
            style={{
              width: "100%", border: "1px solid #e5e5e5", borderRadius: 10, outline: "none",
              padding: "8px 10px", fontSize: 12.5, lineHeight: 1.55, fontFamily: "inherit",
              resize: "none", background: "white", color: "#262626", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onEditSave(c.id)} disabled={submitting} style={{
              background: "#0a0a0a", border: "none", borderRadius: 8, padding: "4px 10px",
              fontSize: 11, fontWeight: 800, color: "white", cursor: "pointer",
            }}>Save</button>
            <button onClick={onEditCancel} style={{
              background: "none", border: "none", padding: "4px 8px",
              fontSize: 11, fontWeight: 600, color: "#525252", cursor: "pointer",
            }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p style={{
          fontSize: 13, lineHeight: 1.55, fontWeight: 500, color: "#262626",
          whiteSpace: "pre-wrap", letterSpacing: "-0.005em", margin: 0,
          overflowWrap: "anywhere", wordBreak: "break-word",
        }}>
          {c.content}
        </p>
      )}
    </div>
  )
}
