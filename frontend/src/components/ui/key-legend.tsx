"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import { formatKey, MOD, useIsApplePlatform } from "@/components/ui/shortcuts-overlay"
import { SPRING_RESPONSIVE } from "@/lib/animations"
import { KEY_ECHO_EVENT } from "@/lib/key-echo"
import { legendKeyFor, ROW_KEYS, type LegendKey } from "@/lib/landing-keys"
import { cn } from "@/lib/utils"

/**
 * A key legend that lights up as keys are used — the landing page's console and the
 * dashboard's key panel draw the same rows from here, so the two cannot drift apart.
 */

/** How long a lit row stays lit. Long enough to find with the eye, short enough to follow a burst. */
const LIT_MS = 700

/**
 * The legend row the last useful keystroke belongs to, for a moment.
 *
 * Passive: it never prevents, never stops propagation, and ignores keys typed into a
 * field, so it cannot change what any key does — it only reports it. The keys that act on
 * a card light when something acted on them: the list and the priority keys say so
 * (`lib/key-echo.ts`), so `Space` behind a hidden cursor or `3` over nothing stays dark —
 * a legend that lights up for a key that did nothing would be the one lie it exists to
 * avoid. The palette's chord and `?` act wherever they are pressed, so their keydown is
 * enough.
 */
export function useLitKey({ enabled }: { enabled: boolean }): LegendKey | null {
  const [lit, setLit] = useState<LegendKey | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return
    const light = (row: LegendKey) => {
      setLit(row)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setLit(null), LIT_MS)
    }
    const onEcho = (event: Event) => {
      const row = (event as CustomEvent<LegendKey>).detail
      if (row) light(row)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null
      ) {
        return
      }
      const row = legendKeyFor(event)
      if (!row || row === "J K" || ROW_KEYS.has(row)) return
      light(row)
    }
    window.addEventListener(KEY_ECHO_EVENT, onEcho)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener(KEY_ECHO_EVENT, onEcho)
      window.removeEventListener("keydown", onKeyDown)
      if (timer.current) clearTimeout(timer.current)
      setLit(null)
    }
  }, [enabled])

  return lit
}

/** How each cap is said: a screen reader given "⏎" says nothing useful, and "J K" is a choice. */
const SPOKEN: Record<LegendKey, string> = {
  "J K": "J or K",
  "⏎": "Enter",
  E: "E",
  Space: "Space",
  "1–5": "1 to 5",
  Delete: "Delete",
  "Mod K": "",
  "?": "Question mark",
}

/** "Mod K" is how the legend names the chord; the cap says the key this keyboard has. */
function useCapLabel(keys: LegendKey): { cap: string; spoken: string } {
  const isApple = useIsApplePlatform()
  if (keys === "Mod K") return { cap: `${formatKey(MOD, isApple)} K`, spoken: `${isApple ? "Command" : "Control"} K` }
  return { cap: keys, spoken: SPOKEN[keys] }
}

/**
 * One row: the key cap, and what it does. The cap presses in and fills with ink while its
 * row is lit; the words go to full ink with it. Keyed to each lighting, so the same key
 * twice presses twice.
 */
export function KeyLegendRow({
  keys,
  does,
  lit,
  note,
  className,
  style,
}: {
  keys: LegendKey
  does: ReactNode
  lit: boolean
  /** A second, quieter line under `does`. */
  note?: ReactNode
  className?: string
  /** For a caller's entrance timing (an animation delay); the row itself sets nothing. */
  style?: CSSProperties
}) {
  const reduce = useReducedMotion() ?? false
  const { cap, spoken } = useCapLabel(keys)
  return (
    // Keys in one column, what they do in the next, both left-aligned: a table the eye can
    // run down.
    <div style={style} className={cn("grid min-h-7 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3", className)}>
      <dt>
        <motion.kbd
          aria-hidden="true"
          key={lit ? `${keys}-lit` : keys}
          initial={lit && !reduce ? { scale: 0.9 } : false}
          animate={{ scale: 1 }}
          transition={SPRING_RESPONSIVE}
          className={cn(
            // `font-sans`, as the app bar's own "Ctrl K" cap: a `<kbd>` otherwise falls back to
            // the browser's monospace, which is not a face this product uses anywhere else.
            "inline-flex h-6 min-w-6 items-center justify-center whitespace-nowrap rounded-sm border px-1.5 font-sans",
            "text-caption font-semibold tabular-nums transition-colors duration-fast",
            lit ? "border-ink bg-ink text-paper" : "border-line bg-paper-sunken text-ink-muted",
          )}
        >
          {cap}
        </motion.kbd>
        <span className="sr-only">{spoken}</span>
      </dt>
      <dd className={cn("text-caption transition-colors duration-fast", lit ? "font-semibold text-ink" : "text-ink-muted")}>
        {does}
        {note ? <span className="block text-caption font-normal text-ink-muted">{note}</span> : null}
      </dd>
    </div>
  )
}
