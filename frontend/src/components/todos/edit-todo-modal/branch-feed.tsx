"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Pencil, Trash2, Send, Plus, FileText, X, ChevronUp, Zap, LogOut, CheckCircle2, Loader2, Sparkles, type LucideIcon } from "lucide-react"
import { fetchComments, addComment, updateComment, deleteComment, getApiErrorMessage } from "@/lib/api"
import type { TodoComment } from "@/types/todo"
import { SPRING_STANDARD } from "@/lib/animations"
import { FriendAvatar } from "./friend-avatar"
import {
  formatDayLabel,
  formatTimeHHMM,
} from "./utils"

const COMMENT_MAX = 2000
const GENESIS_MAX = 5000

// Activity-rail geometry. The rail line is centred at RAIL_CENTER within a wrapper that pads its
// content by RAIL_GUTTER, and every marker is centred on that same x so avatars and system-event
// badges sit exactly on the line. Markers are placed at: left = RAIL_CENTER - RAIL_GUTTER - size/2.
const RAIL_GUTTER = 40
const RAIL_CENTER = 20

// Maps a system-event comment to a colour + icon that conveys its meaning at a glance.
// Matches the English event sentences Todo emits (and keeps the legacy Russian keywords).
function getSystemEventMeta(content: string): { color: string; Icon: LucideIcon } {
  const t = content.toLowerCase()
  if (t.includes("complet") || t.includes("завершил") || t.includes("выполнил"))
    return { color: "#10b981", Icon: CheckCircle2 }
  if (t.includes("start") || t.includes("working") || t.includes("взял в работу") || t.includes("присоединил"))
    return { color: "#4f46e5", Icon: Zap }
  if (t.includes("left") || t.includes("leav") || t.includes("покинул") || t.includes("приостановил"))
    return { color: "#ef4444", Icon: LogOut }
  if (t.includes("creat") || t.includes("создал"))
    return { color: "#8b5cf6", Icon: Sparkles }
  return { color: "#a3a3a3", Icon: Sparkles }
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

// Flat list item (day separator or comment)
type FeedItem =
  | { type: "separator"; label: string; key: string }
  | { type: "comment";   comment: TodoComment }

function buildFeed(comments: TodoComment[]): FeedItem[] {
  const items: FeedItem[] = []
  let lastDay = ""
  for (const c of comments) {
    const day = formatDayLabel(c.createdAt)
    if (day !== lastDay) {
      items.push({ type: "separator", label: day, key: `sep-${c.createdAt}` })
      lastDay = day
    }
    items.push({ type: "comment", comment: c })
  }
  return items
}

export function BranchFeed({
  todoId, isOwner, refreshKey, onSaveDescription,
  inProgress = false, isCompleted = false,
  onStartWork, onStopWork, onCompleteTask,
}: BranchFeedProps) {
  const [comments,   setComments]   = useState<TodoComment[]>([])
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
  const [composeMode, setComposeMode] = useState<"text" | "description">("text")
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  // Pinned Author's Note: condensed sticky header is shown once the full card scrolls away.
  const [genesisOutOfView, setGenesisOutOfView] = useState(false)
  const [genesisHighlight,  setGenesisHighlight]  = useState(false)
  // Which task action (if any) is currently awaiting its async handler.
  const [actionPending, setActionPending] = useState<null | "work" | "complete">(null)

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
  // Pending post-action catch-up reloads (the status system-comment is produced asynchronously).
  const retryTimers       = useRef<ReturnType<typeof setTimeout>[]>([])

  const load = useCallback(async (pageNum: number, replace: boolean, pin: boolean = replace) => {
    try {
      const res  = await fetchComments(todoId, pageNum, 50)
      const items = res.items ?? []
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

  useEffect(() => { load(1, true) }, [load, refreshKey])

  // After an action bumps refreshKey, the resulting status system-comment is materialised
  // asynchronously (Outbox → Inbox). Schedule a few short catch-up merges so it appears within
  // ~1–2s without the user re-opening the modal.
  useEffect(() => {
    if (refreshKey === undefined) return
    retryTimers.current.forEach(clearTimeout)
    // Dense early schedule: with signal-driven outbox dispatch the status comment is written within
    // a fraction of a second, so the first probes catch it almost immediately; the later ones cover
    // a slower poll-fallback dispatch. Cheap (id-keyed merge, no-op when nothing changed).
    retryTimers.current = [250, 600, 1100, 1800, 2800, 4200, 5600]
      .map((ms) => setTimeout(() => { void mergeLatest() }, ms))
    return () => { retryTimers.current.forEach(clearTimeout); retryTimers.current = [] }
  }, [refreshKey, mergeLatest])

  // Gentle live polling while the branch is open — picks up other participants' messages/edits.
  // Paused while the viewer is editing so a refresh never clobbers an in-progress draft.
  useEffect(() => {
    if (editingId || editingGenesis) return
    const id = setInterval(() => { void mergeLatest() }, 5000)
    return () => clearInterval(id)
  }, [mergeLatest, editingId, editingGenesis])

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
  }, [comments])

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
      } else {
        const c = await addComment(todoId, content)
        setComments((prev) => [...prev, c])
        setTotalCount((n) => n + 1)
        setTimeout(scrollToBottom, 40)
      }
      setNewContent("")
      if (composeRef.current) composeRef.current.style.height = "auto"
    } catch (e) {
      setError(getApiErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const feed = buildFeed(stream)

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

        {!loading && stream.length === 0 && (
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

            {feed.map((item) => {
              if (item.type === "separator") {
                return (
                  <DaySeparator key={item.key} label={item.label} />
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
          </div>
        )}
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 11, color: "#ef4444", padding: "4px 0" }}>{error}</p>
      )}

      {/* ── Compose ── */}
      <div style={{ position: "relative", marginTop: 8 }}>

        {/* Mode chip — slides in above compose box when in description mode */}
        {composeMode === "description" && (
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
              <FileText size={11} color="#4f46e5" strokeWidth={2.2} />
              <span style={{
                fontSize: 11, fontWeight: 900, letterSpacing: "0.06em",
                textTransform: "uppercase", color: "#4f46e5",
              }}>
                Description
              </span>
              <button
                onClick={() => { setComposeMode("text"); setNewContent("") }}
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
              task description · ⌘+↵ to send
            </span>
          </div>
        )}

        {/* Compose box — position:relative anchors the floating menu */}
        <div style={{
          position: "relative",
          background: composeMode === "description" ? "#faf5ff" : "#fafafa",
          border: composeMode === "description" ? "1.5px solid #c7d2fe" : "1px solid #f0f0f0",
          borderRadius: 14,
          padding: 4,
          display: "flex",
          alignItems: "center",
          gap: 4,
          transition: "border-color 200ms, background 200ms",
        }}>

          {/* Attach menu — absolutely above the compose box */}
          {plusMenuOpen && (
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
              {showDescription && (
                <>
                  <MenuSectionLabel>Attach</MenuSectionLabel>
                  <button
                    onClick={() => {
                      if (genesis) return
                      setComposeMode("description")
                      setPlusMenuOpen(false)
                      setTimeout(() => composeRef.current?.focus(), 50)
                    }}
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

              {/* Task actions — available to everyone (owner & collaborators) */}
              {(showWorkAction || showCompleteAction) && (
                <>
                  {showDescription && (
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
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                handleSubmitWithMode()
              }
              if (e.key === "Escape" && composeMode === "description") {
                setComposeMode("text")
                setNewContent("")
              }
            }}
            rows={1}
            placeholder={
              composeMode === "description"
                ? "Enter task description…"
                : "Write in branch… ⌘+↵ to send"
            }
            maxLength={composeMode === "description" ? GENESIS_MAX : COMMENT_MAX}
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
              background: newContent.trim() && !submitting
                ? (composeMode === "description" ? "#4f46e5" : "#0a0a0a")
                : "#e5e5e5",
              flexShrink: 0,
              transition: "background 120ms",
            }}
          >
            <Send size={14} color={newContent.trim() && !submitting ? "white" : "#a3a3a3"} />
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
  const { color, Icon } = getSystemEventMeta(comment.content)
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
        boxShadow: `0 0 0 3px #ffffff, inset 0 0 0 1.5px ${color}66`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
      }}>
        <Icon size={12} color={color} strokeWidth={2.4} />
      </div>

      {/* Text row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: SYSTEM_MARKER }}>
        <p style={{ flex: 1, margin: 0, fontSize: 12, fontWeight: 600, color: "#525252", lineHeight: 1.35 }}>
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
        }}>
          {c.content}
        </p>
      )}
    </div>
  )
}
