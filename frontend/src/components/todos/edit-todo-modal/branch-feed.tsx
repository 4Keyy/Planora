"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Pencil, Trash2, Send, Plus, FileText, X } from "lucide-react"
import { fetchComments, addComment, addGenesisComment, updateComment, deleteComment, getApiErrorMessage } from "@/lib/api"
import type { TodoComment } from "@/types/todo"
import { FriendAvatar } from "./friend-avatar"
import {
  formatDayLabel,
  formatTimeHHMM,
  getSystemEventColor,
} from "./utils"

const COMMENT_MAX = 2000
const GENESIS_MAX = 5000

interface BranchFeedProps {
  todoId: string
  isOwner: boolean
  refreshKey?: number
  onDescriptionChange?: (newDescription: string) => void
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

export function BranchFeed({ todoId, isOwner, refreshKey, onDescriptionChange }: BranchFeedProps) {
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

  const feedRef           = useRef<HTMLDivElement>(null)
  const composeRef        = useRef<HTMLTextAreaElement>(null)
  const genesisEditRef    = useRef<HTMLTextAreaElement>(null)
  const plusBtnRef        = useRef<HTMLButtonElement>(null)
  const plusMenuRef       = useRef<HTMLDivElement>(null)

  const load = useCallback(async (pageNum: number, replace: boolean) => {
    try {
      const res  = await fetchComments(todoId, pageNum, 50)
      const items = res.items ?? []
      setTotalCount(res.totalCount ?? 0)
      setComments((prev) => (replace ? items : [...items, ...prev]))
    } catch {
      /* silent */
    } finally {
      setLoading(false)
    }
  }, [todoId])

  useEffect(() => { load(1, true) }, [load, refreshKey])

  const genesis = comments.find((c) => c.isGenesisComment) ?? null
  const stream  = comments.filter((c) => !c.isGenesisComment)
  const hasMore = stream.length < (totalCount - (genesis ? 1 : 0))

  const scrollToBottom = () => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
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
    if (!genesis || submitting) return
    const content = genesisEditContent.trim()
    setSubmitting(true)
    setError(null)
    try {
      if (!content) {
        // Empty → delete the genesis comment entirely
        await deleteComment(todoId, genesis.id)
        setComments((prev) => prev.filter((c) => c.id !== genesis.id))
        setTotalCount((n) => Math.max(0, n - 1))
        onDescriptionChange?.("")
      } else {
        const updated = await updateComment(todoId, genesis.id, content)
        setComments((prev) => prev.map((c) => (c.id === genesis.id ? updated : c)))
        onDescriptionChange?.(content)
      }
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
        const c = await addGenesisComment(todoId, content)
        setComments((prev) => [c, ...prev])
        setTotalCount((n) => n + 1)
        setComposeMode("text")
        onDescriptionChange?.(content)
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
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── Pinned author card ── */}
      {!loading && genesis && (
        <div style={{
          background: "#fafafa",
          border: "1px solid #f0f0f0",
          borderRadius: 18,
          padding: "16px 18px 18px",
          marginBottom: 14,
        }}>
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <FriendAvatar
                friend={{ id: genesis.authorId, firstName: genesis.authorName?.split(" ")[0], lastName: genesis.authorName?.split(" ")[1] }}
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

      {/* ── Timeline rail ── */}
      <div
        ref={feedRef}
        className="branch-scroll"
        style={{
          position: "relative",
          paddingLeft: 42,
          paddingRight: 4,
          paddingTop: 4,
          paddingBottom: 4,
          maxHeight: 420,
          overflowY: "auto",
        }}
      >
        {/* Continuous rail line */}
        <div style={{
          position: "absolute",
          left: 17,
          top: 16,
          bottom: 16,
          width: 2,
          background: "#eaeaea",
          borderRadius: 1,
          pointerEvents: "none",
        }} />

        {/* Load earlier */}
        {hasMore && !loading && (
          <button
            onClick={handleLoadMore}
            style={{
              display: "block", marginBottom: 8, marginLeft: -8,
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
          <p style={{ fontSize: 12, color: "#a3a3a3", marginLeft: -8 }}>Loading…</p>
        )}

        {!loading && stream.length === 0 && (
          <p style={{ fontSize: 12, color: "#a3a3a3", marginLeft: -8, fontStyle: "italic" }}>
            No messages yet
          </p>
        )}

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
              <div style={{
                fontSize: 9, fontWeight: 900, letterSpacing: "0.14em",
                textTransform: "uppercase", color: "#a3a3a3",
                padding: "4px 10px 8px",
              }}>
                Attach
              </div>

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

/* ── Day separator ── */
function DaySeparator({ label }: { label: string }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", padding: "10px 0 6px", marginLeft: -32 }}>
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
function SystemEvent({ comment }: { comment: TodoComment }) {
  const color = getSystemEventColor(comment.content)
  return (
    <div style={{ position: "relative", paddingTop: 2, paddingBottom: 8 }}>
      {/* Marker */}
      <div style={{
        position: "absolute",
        left: -32,
        top: 4,
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: "white",
        boxShadow: `0 0 0 2px white, 0 0 0 3px ${color}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      </div>

      {/* Text row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingTop: 2 }}>
        <p style={{ flex: 1, margin: 0, fontSize: 12, fontWeight: 600, color: "#525252", lineHeight: 1.4 }}>
          <strong style={{ fontWeight: 900, color: "#0a0a0a" }}>
            {comment.authorName}
          </strong>{" "}
          {comment.content.replace(new RegExp("^" + comment.authorName + "\\s*"), "")}
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
        padding: "9px 10px 9px 12px",
        margin: "2px 0 2px -8px",
        borderRadius: 12,
        background: hovered ? "#fafafa" : "transparent",
        transition: "background 140ms",
      }}
    >
      {/* Avatar marker on rail */}
      <div style={{
        position: "absolute",
        left: -32,
        top: 9,
        zIndex: 1,
      }}>
        <FriendAvatar
          friend={{ id: c.authorId, firstName: c.authorName?.split(" ")[0], lastName: c.authorName?.split(" ")[1] }}
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
