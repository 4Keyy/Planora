"use client"

import { useState } from "react"
import { Lock, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

interface WorkerJoinButtonProps {
  isOwner: boolean
  isWorking: boolean
  isFull: boolean
  workerCount?: number
  requiredWorkers?: number | null
  onJoin: () => Promise<void>
  onLeave: () => Promise<void>
  onControlHoverChange?: (hovered: boolean) => void
}

export function WorkerJoinButton({
  isOwner,
  isWorking,
  isFull,
  workerCount,
  requiredWorkers,
  onJoin,
  onLeave,
  onControlHoverChange,
}: WorkerJoinButtonProps) {
  const [pending, setPending] = useState(false)

  if (isOwner) return null

  const handle = (fn: () => Promise<void>) => async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (pending) return
    setPending(true)
    try { await fn() } finally { setPending(false) }
  }

  // Only count-label when at least 1 non-owner worker has joined; owner is implicit
  const hasWorkers = (workerCount ?? 0) > 0
  const totalWorking = (workerCount ?? 0) + 1  // +1 for owner
  const countLabel = hasWorkers
    ? (requiredWorkers
        ? `${totalWorking} / ${requiredWorkers}`
        : `${totalWorking} working`)
    : null

  const hoverProps = {
    onMouseEnter: () => onControlHoverChange?.(true),
    onMouseLeave: () => onControlHoverChange?.(false),
  }

  // ── In work ───────────────────────────────────────────────────────────────
  if (isWorking) {
    return (
      <div
        {...hoverProps}
        className="flex items-center justify-between border-t border-indigo-100 bg-indigo-50/70 px-4 py-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          <span className="text-[11px] font-black uppercase tracking-wider text-indigo-700">
            In work
          </span>
        </div>

        <div className="flex items-center gap-3">
          {countLabel && (
            <span className="text-[10px] font-bold text-indigo-300">{countLabel}</span>
          )}
          <button
            onClick={handle(onLeave)}
            disabled={pending}
            className="text-[10px] font-black uppercase tracking-wider text-indigo-300 transition-colors hover:text-red-500 disabled:opacity-50"
          >
            {pending ? "···" : "leave"}
          </button>
        </div>
      </div>
    )
  }

  // ── Full ──────────────────────────────────────────────────────────────────
  if (isFull) {
    return (
      <div
        className="flex items-center justify-between border-t border-gray-100 bg-gray-50/40 px-4 py-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 text-gray-400">
          <Lock className="h-3 w-3" />
          <span className="text-[11px] font-black uppercase tracking-wider">Full</span>
        </div>
        {countLabel && (
          <span className="text-[10px] font-bold text-gray-300">{countLabel}</span>
        )}
      </div>
    )
  }

  // ── Take it ───────────────────────────────────────────────────────────────
  return (
    <button
      onClick={handle(onJoin)}
      disabled={pending}
      {...hoverProps}
      className={cn(
        "group/join flex w-full items-center justify-between",
        "border-t border-indigo-100/60 px-4 py-2.5",
        "bg-transparent transition-colors hover:bg-indigo-50/50 disabled:opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Zap className="h-3 w-3 text-indigo-300 transition-colors group-hover/join:text-indigo-500" />
        <span className="text-[11px] font-black uppercase tracking-wider text-indigo-400 transition-colors group-hover/join:text-indigo-600">
          {pending ? "Joining···" : "Take it"}
        </span>
        {!pending && (
          <span className="text-[11px] text-indigo-300 transition-transform group-hover/join:translate-x-0.5 group-hover/join:text-indigo-400">
            →
          </span>
        )}
      </div>
      {countLabel && (
        <span className="text-[10px] font-bold text-indigo-200 transition-colors group-hover/join:text-indigo-300">
          {countLabel}
        </span>
      )}
    </button>
  )
}
