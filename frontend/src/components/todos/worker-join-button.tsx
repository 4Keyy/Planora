"use client"

import { useState } from "react"
import { Lock, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

interface WorkerJoinButtonProps {
  isOwner: boolean
  isWorking: boolean
  isFull: boolean
  onJoin: () => Promise<void>
  onLeave: () => Promise<void>
  onControlHoverChange?: (hovered: boolean) => void
}

export function WorkerJoinButton({
  isOwner,
  isWorking,
  isFull,
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

  const hoverProps = {
    onMouseEnter: () => onControlHoverChange?.(true),
    onMouseLeave: () => onControlHoverChange?.(false),
  }

  // ── In work ───────────────────────────────────────────────────────────────
  if (isWorking) {
    return (
      <div
        {...hoverProps}
        className="flex items-center border-t border-accent-surface bg-accent-surface/70 px-4 py-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="relative flex h-2 w-2 flex-shrink-0 mr-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        <span className="text-caption font-bold uppercase tracking-wider text-accent">
          In work
        </span>
        <span className="text-caption text-accent/50 mx-1.5" aria-hidden="true">·</span>
        <button
          onClick={handle(onLeave)}
          disabled={pending}
          className="text-caption font-semibold text-accent transition-colors hover:text-alert disabled:opacity-50"
        >
          {pending ? "···" : "leave"}
        </button>
      </div>
    )
  }

  // ── Full ──────────────────────────────────────────────────────────────────
  if (isFull) {
    return (
      <div
        className="flex items-center gap-1.5 border-t border-line bg-paper-sunken/40 px-4 py-2.5 text-ink-subtle"
        onClick={(e) => e.stopPropagation()}
      >
        <Lock className="h-3 w-3" />
        <span className="text-caption font-bold uppercase tracking-wider">Full</span>
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
        "group/join flex w-full items-center",
        "border-t border-accent-surface/60 px-4 py-2.5",
        "bg-transparent transition-colors hover:bg-accent-surface/50 disabled:opacity-60",
      )}
    >
      <Zap className="h-3 w-3 text-accent/70 mr-1.5 transition-colors group-hover/join:text-accent" aria-hidden="true" />
      <span className="text-caption font-bold uppercase tracking-wider text-accent transition-colors group-hover/join:text-accent">
        {pending ? "Joining···" : "Take it"}
      </span>
      {!pending && (
        <span className="text-caption text-accent/70 ml-1 transition-transform group-hover/join:translate-x-0.5 group-hover/join:text-accent" aria-hidden="true">
          →
        </span>
      )}
    </button>
  )
}
