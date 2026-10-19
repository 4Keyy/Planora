"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"
import type { TitleRequest } from "@/components/todos/create-todo-panel"
import { canHandleCreateShortcut, CREATE_TASK_EVENT, requestNewTask, takeCreateTaskRequest } from "@/lib/create-task-request"

export function useNewTaskShortcut({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  const panelRef = useRef<HTMLElement>(null)
  const [titleRequest, setTitleRequest] = useState<TitleRequest | null>(null)
  const open = useRef(onOpen)
  open.current = onOpen
  const reduce = useReducedMotion() ?? false

  useEffect(() => {
    if (!enabled) return
    const consume = () => {
      const request = takeCreateTaskRequest()
      if (!request) return
      setTitleRequest(request)
      open.current()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!canHandleCreateShortcut(event)) return
      event.preventDefault()
      requestNewTask()
    }
    window.addEventListener(CREATE_TASK_EVENT, consume)
    window.addEventListener("keydown", onKeyDown, true)
    consume()
    return () => {
      window.removeEventListener(CREATE_TASK_EVENT, consume)
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [enabled])

  useEffect(() => {
    if (!titleRequest) return
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const box = panel.getBoundingClientRect()
      if (box.top < 0 || box.bottom > window.innerHeight) {
        panel.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [titleRequest, reduce])

  return { panelRef, titleRequest }
}
