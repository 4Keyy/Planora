"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAuthStore } from "@/store/auth"
import {
  realtime,
  type BranchChangedPayload,
  type TaskFeedChangedPayload,
  type TypingPayload,
} from "@/lib/realtime/client"

/**
 * Owns the single connection's lifecycle: open it while the user is authenticated, close it on
 * logout. Mounted once near the app root. Re-runs when the token identity changes so a fresh login
 * (or account switch) reconnects with the new credentials.
 */
export function useRealtimeLifecycle(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const accessToken = useAuthStore((s) => s.accessToken)

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      void realtime.stop()
      return
    }
    void realtime.start()
    // We intentionally do NOT stop() on every token refresh — only on real logout (handled by the
    // !isAuthenticated branch). The live connection keeps running across silent token rotations.
  }, [isAuthenticated, accessToken])
}

/**
 * Subscribes to live feed changes (a friend created/updated/deleted/completed a task the viewer can
 * see). The handler receives a thin signal; the caller reconciles by refetching the affected task.
 * The latest handler is always invoked without re-subscribing on every render.
 */
export function useFeedSync(onChange: (payload: TaskFeedChangedPayload) => void): void {
  const handlerRef = useRef(onChange)
  handlerRef.current = onChange

  useEffect(() => {
    return realtime.on("TaskFeedChanged", (payload) => handlerRef.current(payload))
  }, [])
}

/**
 * Joins a task's branch room for as long as the component is mounted (a branch page or the edit
 * modal), and invokes `onChange` whenever something in that branch changes. Membership is
 * reference-counted in the client, so the modal and the page can both be open without fighting.
 */
export function useBranchRoom(
  taskId: string | null | undefined,
  onChange: (payload: BranchChangedPayload) => void,
): void {
  const handlerRef = useRef(onChange)
  handlerRef.current = onChange

  useEffect(() => {
    if (!taskId) return

    void realtime.start().then(() => realtime.joinTask(taskId))

    const off = realtime.on("BranchChanged", (payload) => {
      if (payload.taskId === taskId) handlerRef.current(payload)
    })

    return () => {
      off()
      void realtime.leaveTask(taskId)
    }
  }, [taskId])
}

const TYPING_THROTTLE_MS = 2_000
const TYPING_IDLE_MS = 3_000
/** A typing indicator self-expires if a StopTyping is ever missed (tab crash, transport drop). */
const TYPING_TTL_MS = 6_000

interface TypingState {
  name: string
  expiresAt: number
}

/**
 * Branch typing presence. Returns the display names currently typing in the branch (excluding the
 * viewer, since the hub only relays to others) plus a `notifyTyping` to call on each keystroke.
 *
 * `notifyTyping` throttles StartTyping to one signal per few seconds and schedules a StopTyping
 * after a short idle gap, so a burst of keystrokes produces minimal traffic. Indicators also carry
 * a TTL and are swept on an interval, so a dropped StopTyping never leaves a stuck "… печатает".
 */
export function useTyping(taskId: string | null | undefined, enabled: boolean): {
  typingNames: string[]
  notifyTyping: () => void
} {
  const [typingNames, setTypingNames] = useState<string[]>([])
  const typersRef = useRef<Map<string, TypingState>>(new Map())
  const lastSentRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const recompute = useCallback(() => {
    const now = Date.now()
    const names: string[] = []
    for (const [userId, state] of typersRef.current) {
      if (state.expiresAt <= now) {
        typersRef.current.delete(userId)
      } else {
        names.push(state.name)
      }
    }
    setTypingNames(names)
  }, [])

  // Receive others' typing signals for this room.
  useEffect(() => {
    if (!taskId || !enabled) {
      typersRef.current.clear()
      setTypingNames([])
      return
    }

    const apply = (payload: TypingPayload, typing: boolean) => {
      if (payload.taskId !== taskId) return
      if (typing) {
        typersRef.current.set(payload.userId, {
          name: payload.name?.trim() || "Someone",
          expiresAt: Date.now() + TYPING_TTL_MS,
        })
      } else {
        typersRef.current.delete(payload.userId)
      }
      recompute()
    }

    const offTyping = realtime.on("UserTyping", (p) => apply(p, true))
    const offStopped = realtime.on("UserStoppedTyping", (p) => apply(p, false))
    const sweep = setInterval(recompute, 2_000)

    return () => {
      offTyping()
      offStopped()
      clearInterval(sweep)
      typersRef.current.clear()
      setTypingNames([])
    }
  }, [taskId, enabled, recompute])

  const notifyTyping = useCallback(() => {
    if (!taskId || !enabled) return

    const now = Date.now()
    if (now - lastSentRef.current > TYPING_THROTTLE_MS) {
      lastSentRef.current = now
      void realtime.startTyping(taskId)
    }

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      lastSentRef.current = 0
      void realtime.stopTyping(taskId)
    }, TYPING_IDLE_MS)
  }, [taskId, enabled])

  // Clear our own indicator if we unmount mid-type.
  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (taskId && enabled) void realtime.stopTyping(taskId)
    }
  }, [taskId, enabled])

  return { typingNames, notifyTyping }
}
