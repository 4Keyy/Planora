"use client"

import { MotionConfig } from "framer-motion"
import { ReactNode } from "react"

/**
 * T4.10 — wraps the tree in a single `MotionConfig` with `reducedMotion="user"`.
 * That setting tells every nested `framer-motion` component to honour the OS-level
 * `prefers-reduced-motion: reduce` media query automatically: transforms and
 * physics collapse, opacity and colour transitions remain, no per-component
 * `useReducedMotion()` boilerplate required.
 *
 * Server Components cannot use the framer-motion runtime, so this is a "use
 * client" boundary at the root of the layout. Keep it cheap — no other side
 * effects, no extra context — so it stays free for routes that never animate.
 */
export function MotionPreferencesProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
