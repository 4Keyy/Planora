"use client"

import { ReactNode, useEffect, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

export function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)

  // Hydrate without a portal, then attach it before paint so a newly opened
  // dialog does not wait for a separate passive-effect commit.
  useIsomorphicLayoutEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null
  return createPortal(children, document.body)
}
