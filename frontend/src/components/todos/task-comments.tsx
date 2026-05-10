"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Pencil, Trash2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { fetchComments, addComment, updateComment, deleteComment } from "@/lib/api"
import { getApiErrorMessage } from "@/lib/api"
import type { TodoComment } from "@/types/todo"
import { cn } from "@/lib/utils"

const CONTENT_MAX = 2000

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
}

export function TaskComments({ todoId, isOwner, canComment }: TaskCommentsProps) {
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
  }, [load])

  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [loading, comments.length])

  const hasMore = comments.length < totalCount

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

  return (
    <div className="flex flex-col gap-3 pt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Comments {totalCount > 0 && `· ${totalCount}`}
      </p>

      {loading ? (
        <p className="text-xs text-neutral-400">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
          {hasMore && (
            <button
              onClick={handleLoadMore}
              className="text-xs text-indigo-600 hover:underline self-start"
            >
              Load earlier comments
            </button>
          )}

          {comments.length === 0 && (
            <p className="text-xs text-neutral-400 italic">No comments yet.</p>
          )}

          {comments.map((c) => (
            <div key={c.id} className="group flex flex-col gap-0.5 rounded-lg bg-neutral-50 px-3 py-2">
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
                    maxLength={CONTENT_MAX}
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
                <p className="text-xs text-neutral-700 whitespace-pre-wrap break-words">{c.content}</p>
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
          ))}

          <div ref={bottomRef} />
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {canComment && (
        <div className="flex flex-col gap-1">
          <Textarea
            placeholder="Add a comment… (Ctrl+Enter to submit)"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            className="text-xs min-h-[60px] resize-none"
            maxLength={CONTENT_MAX}
            disabled={submitting}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit()
            }}
          />
          <div className="flex items-center justify-between">
            <span className={cn("text-[10px]", newContent.length > CONTENT_MAX * 0.8 ? "text-amber-500" : "text-neutral-400")}>
              {newContent.length}/{CONTENT_MAX}
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
