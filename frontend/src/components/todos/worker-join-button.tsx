"use client"

import { useState } from "react"
import { Users, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface WorkerJoinButtonProps {
  todoId: string
  isOwner: boolean
  isWorking: boolean
  isFull: boolean
  onJoin: () => Promise<void>
  onLeave: () => Promise<void>
}

export function WorkerJoinButton({
  isOwner,
  isWorking,
  isFull,
  onJoin,
  onLeave,
}: WorkerJoinButtonProps) {
  const [pending, setPending] = useState(false)

  if (isOwner) return null

  const handleClick = async () => {
    if (pending) return
    setPending(true)
    try {
      if (isWorking) {
        await onLeave()
      } else {
        await onJoin()
      }
    } finally {
      setPending(false)
    }
  }

  if (!isWorking && isFull) {
    return (
      <button
        disabled
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium",
          "border border-neutral-300 text-neutral-400 cursor-not-allowed select-none",
        )}
      >
        <Lock className="h-3 w-3" />
        Full
      </button>
    )
  }

  return (
    <Button
      size="sm"
      variant={isWorking ? "outline" : "default"}
      className={cn(
        "h-7 px-3 text-xs",
        isWorking
          ? "border-neutral-300 text-neutral-600 hover:border-red-300 hover:text-red-600"
          : "bg-indigo-600 text-white hover:bg-indigo-700",
      )}
      disabled={pending}
      onClick={handleClick}
    >
      <Users className="mr-1.5 h-3 w-3" />
      {pending ? "..." : isWorking ? "Leave" : "Join"}
    </Button>
  )
}
