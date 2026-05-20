"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Pencil, Trash2, Send, ScrollText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { fetchComments, addComment, updateComment, deleteComment } from "@/lib/api"
import { getApiErrorMessage } from "@/lib/api"
import type { TodoComment } from "@/types/todo"
import { cn } from "@/lib/utils"

const COMMENT_MAX = 2000
const GENESIS_MAX = 5000

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}

interface TaskCommentsProps {
  todoId: string
  isOwner: boolean
  canComment: boolean
  refreshKey?: number
}

export function TaskComments({ todoId, isOwner, canComment, refreshKey }: TaskCommentsProps) {
  const [comments, setComments] = useState<TodoComment[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [newContent, setNewContent] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(
    async (pageNum: number, replace: boolean) => {
      try {
        const res = await fetchComments(todoId, pageNum, 50)
        const items = res.items ?? []
        setTotalCount(res.totalCount ?? 0)
        setComments((prev) => (replace ? items : [...items, ...prev]))
      } catch {
        // ignore load errors silently
      } finally {
        setLoading(false)
      }
    },
    [todoId],
  )

  useEffect(() => {
    load(1, true)
  }, [load, refreshKey])

  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [loading, comments.length])

  const genesis = comments.find((c) => c.isGenesisComment)
  const stream = comments.filter((c) => !c.isGenesisComment)
  const hasMore = stream.length < (totalCount - (genesis ? 1 : 0))

  const handleLoadMore = async () => {
    const nextPage = page + 1
    setPage(nextPage)
    await load(nextPage, false)
  }

  const handleSubmit = async () => {
    const content = newContent.trim()
    if (!content || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const comment = await addComment(todoId, content)
      setComments((prev) => [...prev, comment])
      setTotalCount((c) => c + 1)
      setNewContent("")
    } catch (e) {
      setError(getApiErrorMessage(e))
    } finally {
      setSubmitting(false)
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

  const handleDelete = async (id: string) => {
    setError(null)
    try {
      await deleteComment(todoId, id)
      setComments((prev) => prev.filter((c) => c.id !== id))
      setTotalCount((c) => Math.max(0, c - 1))
    } catch (e) {
      setError(getApiErrorMessage(e))
    }
  }

  const streamCount = totalCount - (genesis ? 1 : 0)

  return (
    <div className="flex flex-col gap-3 pt-1">

      {/* ── Genesis Card (pinned description) ──────────────────────────── */}
      {loading ? null : genesis ? (
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-violet-50/40 p-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100">
                <ScrollText className="h-3.5 w-3.5 text-indigo-500" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500 leading-none">
                  Description
                </p>
                {genesis.authorName && (
                  <p className="text-[10px] text-indigo-400 font-medium mt-0.5 leading-none">
                    by {genesis.authorName}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {genesis.isEdited && (
                <span className="text-[9px] text-indigo-300 italic">edited</span>
              )}
              <span className="text-[10px] text-indigo-300">{formatRelative(genesis.createdAt)}</span>
              {isOwner && editingId !== genesis.id && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setEditingId(genesis.id); setEditContent(genesis.content) }}
                    className="text-indigo-300 hover:text-indigo-500 transition-colors p-0.5 rounded"
                    title="Edit description"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(genesis.id)}
                    className="text-indigo-300 hover:text-red-400 transition-colors p-0.5 rounded"
                    title="Delete description"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Body */}
          {editingId === genesis.id ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="text-sm min-h-[80px] resize-none bg-white/70 border-indigo-200 focus-visible:ring-indigo-300 rounded-xl leading-relaxed"
                maxLength={GENESIS_MAX}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleEditSave(genesis.id)
                  if (e.key === "Escape") setEditingId(null)
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className={cn(
                  "text-[10px]",
                  editContent.length > GENESIS_MAX * 0.85 ? "text-amber-500" : "text-indigo-300"
                )}>
                  {editContent.length}/{GENESIS_MAX}
                </span>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-6 text-xs bg-indigo-500 hover:bg-indigo-600 rounded-lg"
                    onClick={() => handleEditSave(genesis.id)}
                    disabled={submitting}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs rounded-lg"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-indigo-900/80 whitespace-pre-wrap break-words leading-relaxed">
              {genesis.content}
            </p>
          )}
        </div>
      ) : null}

      {/* ── Discussion Stream ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Task {streamCount > 0 && `· ${streamCount}`}
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-neutral-400">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
          {hasMore && (
            <button
              onClick={handleLoadMore}
              className="text-xs text-indigo-500 hover:underline self-start"
            >
              Load earlier messages
            </button>
          )}

          {stream.length === 0 && (
            <p className="text-xs text-neutral-400 italic">No messages yet.</p>
          )}

          {stream.map((c) => {
            if (c.isSystemComment) {
              return (
                <div key={c.id} className="flex flex-col items-center gap-0.5 py-1">
                  <div className="flex items-center gap-2 w-full">
                    <div className="flex-1 h-px bg-neutral-100" />
                    <span className="text-[10px] text-neutral-400 text-center px-2 shrink-0">{c.content}</span>
                    <div className="flex-1 h-px bg-neutral-100" />
                  </div>
                  <span className="text-[9px] text-neutral-300">{formatRelative(c.createdAt)}</span>
                </div>
              )
            }

            return (
              <div key={c.id} className="group flex flex-col gap-0.5 rounded-xl bg-neutral-50 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-neutral-800">{c.authorName}</span>
                  <span className="text-[10px] text-neutral-400 shrink-0">
                    {formatRelative(c.createdAt)}
                    {c.isEdited && " · edited"}
                  </span>
                </div>

                {editingId === c.id ? (
                  <div className="flex flex-col gap-1 mt-1">
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="text-xs min-h-[60px] resize-none"
                      maxLength={COMMENT_MAX}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleEditSave(c.id)
                        if (e.key === "Escape") setEditingId(null)
                      }}
                    />
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-6 text-xs" onClick={() => handleEditSave(c.id)} disabled={submitting}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-700 whitespace-pre-wrap break-words leading-relaxed">{c.content}</p>
                )}

                {(c.isOwn || isOwner) && editingId !== c.id && (
                  <div className="flex gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {c.isOwn && (
                      <button
                        onClick={() => { setEditingId(c.id); setEditContent(c.content) }}
                        className="text-[10px] text-neutral-400 hover:text-neutral-600 flex items-center gap-0.5"
                      >
                        <Pencil className="h-2.5 w-2.5" /> Edit
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-[10px] text-neutral-400 hover:text-red-500 flex items-center gap-0.5"
                    >
                      <Trash2 className="h-2.5 w-2.5" /> Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          <div ref={bottomRef} />
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {canComment && (
        <div className="flex flex-col gap-1">
          <Textarea
            placeholder="Add a message… (Ctrl+Enter to send)"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            className="text-xs min-h-[56px] resize-none"
            maxLength={COMMENT_MAX}
            disabled={submitting}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit()
            }}
          />
          <div className="flex items-center justify-between">
            <span className={cn("text-[10px]", newContent.length > COMMENT_MAX * 0.8 ? "text-amber-500" : "text-neutral-400")}>
              {newContent.length}/{COMMENT_MAX}
            </span>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSubmit}
              disabled={submitting || !newContent.trim()}
            >
              <Send className="mr-1.5 h-3 w-3" />
              {submitting ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
