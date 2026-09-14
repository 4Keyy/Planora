"use client"

import { Fragment, useEffect, useId, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Overlay } from "@/components/ui/overlay"

/**
 * The keyboard, taught by the product instead of documented away from it.
 *
 * Seventeen keys ship in this app and nothing on screen says so. A shortcut a
 * person cannot discover is a shortcut nobody uses, which makes the whole
 * keyboard layer dead weight; `?` is the one convention that reliably reveals
 * it, so it is the one this file owns.
 *
 * `SHORTCUT_GROUPS` is exported because it has to be the only list. The command
 * palette already prints a `shortcut` string on every row and the task rows
 * print their own hints — three hand-written copies of "Shift+G" drift the
 * moment one of them changes, and the drift is invisible until a user presses
 * the key the UI promised and nothing happens. One array, three readers.
 *
 * Nothing here animates. The Overlay underneath already carries the entrance,
 * and a staggered reveal on a reference card fights the reason it was opened:
 * the reader is looking for one row and wants it legible on frame one.
 */

// ─── Vocabulary ─────────────────────────────────────────────────────────────

/**
 * The platform-dependent chord key. Stored as a sentinel rather than a glyph so
 * the array itself stays platform-free — `formatKey` decides late, once the
 * client knows what it is running on.
 */
export const MOD = "Mod"

/**
 * Words that join keys rather than being keys.
 *
 * `then` and `or` are load-bearing distinctions: "G then G" is a sequence and
 * "G + G" is nonsense, "J or K" is a choice and "J + K" is a chord nobody can
 * press. The `Shortcut` shape is a flat `string[]` — deliberately, so the
 * palette can consume it without learning a grammar — so the connector lives
 * inline and is recognised by value.
 */
const CONNECTORS = new Set(["then", "or"])

/**
 * How a symbol-only cap is pronounced.
 *
 * A screen reader given `↑` says "up arrow" at best and nothing at worst, and
 * `⌘` is routinely read as "place of interest sign". Every cap whose glyph is
 * not its own name is spelled out here; letters and digits are their own
 * pronunciation and are left alone.
 */
const SPOKEN: Record<string, string> = {
  "⌘": "Command",
  Ctrl: "Control",
  "⏎": "Enter",
  "↑": "Arrow Up",
  "↓": "Arrow Down",
  Esc: "Escape",
  "?": "Question mark",
  "1–5": "1 to 5",
}

export interface Shortcut {
  /** Caps in press order. `MOD` resolves per platform; `"then"` / `"or"` join. */
  keys: string[]
  description: string
}

export interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

/** The single source of truth for every key the product answers to. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Anywhere",
    shortcuts: [
      { keys: [MOD, "K"], description: "Open the command palette" },
      { keys: ["C"], description: "Capture a new task" },
      { keys: ["?"], description: "Show this list" },
      { keys: ["Esc"], description: "Close whatever is open" },
    ],
  },
  {
    title: "The list",
    shortcuts: [
      { keys: ["J", "or", "K"], description: "Move down or up" },
      { keys: ["G", "then", "G"], description: "Jump to the first task" },
      { keys: ["Shift", "G"], description: "Jump to the last task" },
      { keys: ["⏎"], description: "Open the highlighted task" },
      { keys: ["Space"], description: "Complete or reopen it" },
      { keys: ["E"], description: "Edit it in place" },
      { keys: ["1–5"], description: "Set priority" },
      { keys: ["X"], description: "Add it to the selection" },
      { keys: ["Shift", "↑", "or", "↓"], description: "Extend the selection" },
      { keys: [MOD, "A"], description: "Select everything" },
      // "the highlighted task", not "the selection": Delete acts on the cursor
      // alone, and the list hook makes that choice deliberately — a keystroke that
      // silently took twelve tasks because an `x` scrolled out of view is not one
      // anybody can take back. The bulk bar is where a selection gets deleted, and
      // it says how many first.
      { keys: ["Delete"], description: "Delete the highlighted task" },
    ],
  },
  {
    title: "A branch",
    shortcuts: [
      { keys: ["Esc"], description: "Close the branch" },
      { keys: [MOD, "⏎"], description: "Send the message" },
    ],
  },
]

// ─── Platform ───────────────────────────────────────────────────────────────

/**
 * Whether the keyboard in front of the user has a Command key.
 *
 * Resolved in an effect, never during render. The server has no `navigator`, so
 * a render-time read emits "Ctrl" from the server and "⌘" from the client and
 * React throws the entire server pass away as a hydration mismatch — the bug
 * `command-palette.tsx` still carries at its `isMac` line.
 *
 * The default before the effect runs is deliberately `false`, the Ctrl
 * spelling: it is correct for most of the installed base, so most people never
 * see a change at all, and the minority who do see it flip inside the first
 * frame after mount rather than watching the wrong glyph settle.
 */
export function useIsApplePlatform(): boolean {
  const [isApple, setIsApple] = useState(false)

  useEffect(() => {
    const nav = window.navigator
    // `platform` is deprecated but is still the only direct answer; the UA is
    // the fallback for engines that have already frozen it to "".
    setIsApple(/Mac|iPhone|iPad|iPod/.test(nav.platform || nav.userAgent))
  }, [])

  return isApple
}

/** Turns a stored cap into the glyph this platform actually prints. */
export function formatKey(key: string, isApple: boolean): string {
  if (key === MOD) return isApple ? "⌘" : "Ctrl"
  return key
}

/** The whole chord as a sentence: `["Shift", "↑"]` → "Shift plus Arrow Up". */
function speakCombo(keys: string[], isApple: boolean): string {
  const spoken: string[] = []
  keys.forEach((key, i) => {
    if (CONNECTORS.has(key)) {
      spoken.push(key)
      return
    }
    const previous = keys[i - 1]
    // "plus" only between two real keys — never around "then" or "or", which
    // already read as the join.
    if (previous !== undefined && !CONNECTORS.has(previous)) spoken.push("plus")
    const glyph = formatKey(key, isApple)
    spoken.push(SPOKEN[glyph] ?? glyph)
  })
  return spoken.join(" ")
}

// ─── Caps ───────────────────────────────────────────────────────────────────

/**
 * One key cap.
 *
 * `min-w-5` and `tabular-nums` exist so a row of digits and a row of letters
 * come out the same width; without them the right-hand column of the map
 * ragged by a few pixels per row and read as a list of unrelated badges rather
 * than a column.
 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line bg-paper-sunken px-1.5 text-caption font-semibold tabular-nums text-ink-muted">
      {children}
    </kbd>
  )
}

/**
 * A full chord.
 *
 * The caps are `aria-hidden` and the meaning is carried once, by the `sr-only`
 * sentence beside them. Letting a screen reader walk the caps themselves would
 * announce "⌘", "plus", "K" as three separate nodes — three stops for one fact,
 * and two of them unpronounceable.
 */
export function KeyCombo({ keys }: { keys: string[] }) {
  const isApple = useIsApplePlatform()

  return (
    <span className="inline-flex items-center gap-1">
      <span className="sr-only">{speakCombo(keys, isApple)}</span>
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        {keys.map((key, i) => {
          const previous = keys[i - 1]
          const isConnector = CONNECTORS.has(key)
          const needsPlus = previous !== undefined && !isConnector && !CONNECTORS.has(previous)

          return (
            <Fragment key={`${key}-${i}`}>
              {needsPlus ? <span className="text-caption font-medium text-ink-subtle">+</span> : null}
              {isConnector ? (
                <span className="text-caption font-medium text-ink-subtle">{key}</span>
              ) : (
                <Kbd>{formatKey(key, isApple)}</Kbd>
              )}
            </Fragment>
          )
        })}
      </span>
    </span>
  )
}

// ─── The map ────────────────────────────────────────────────────────────────

export interface ShortcutsOverlayProps {
  open: boolean
  onClose: () => void
}

export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  const headingId = useId()

  return (
    <Overlay open={open} onClose={onClose} labelledBy={headingId} hideHeader className="max-w-2xl">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={headingId} className="text-title-sm font-bold tracking-tight text-ink">
              Keyboard shortcuts
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-body-sm font-medium text-ink-subtle">
              Press <KeyCombo keys={["?"]} /> anywhere to bring this back.
            </p>
          </div>
          {/*
            A ghost icon button rather than a bare glyph: the Button primitive
            brings the 44x44 hit area and leaves the global :focus-visible rule
            to paint the ring.
          */}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close keyboard shortcuts">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {/*
          Two columns from `md`, one on a phone. The map is a reference, not a
          flow: side by side the reader scans group titles, stacked at 390px the
          same grid would push "A branch" three screens down.
        */}
        <div className="mt-6 grid gap-x-8 gap-y-6 md:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
                {group.title}
              </h3>
              <dl className="mt-2">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-b-0"
                  >
                    <dt className="text-body-sm font-medium text-ink">{shortcut.description}</dt>
                    <dd className="shrink-0">
                      <KeyCombo keys={shortcut.keys} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </Overlay>
  )
}

// ─── The `?` listener ───────────────────────────────────────────────────────

export interface ShortcutsOverlayState {
  open: boolean
  setOpen: (value: boolean) => void
}

/**
 * Owns the global `?`.
 *
 * Matched on `e.key === "?"` rather than Shift plus a keyCode, because `?` is
 * unshifted on several layouts and sits on a different physical key on most of
 * the non-US ones — a keyCode check ships a shortcut that only exists on ANSI
 * hardware.
 *
 * The text-field guard is the same three-way test the list shortcuts use
 * (`tasks/page.tsx`, `categories/page.tsx`, `dashboard/page.tsx` — five copies
 * of it across four files today). Without it, typing "Why?" into a task title
 * opens the shortcut map mid-word.
 *
 * Capture phase, matching those call sites, so the key is claimed before a
 * focused widget can swallow it.
 */
export function useShortcutsOverlay(): ShortcutsOverlayState {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "?") return
      // A modified `?` belongs to the browser or the OS, not to us.
      if (e.ctrlKey || e.altKey || e.metaKey) return
      /*
       * `isContentEditable` alone is not enough, and the gap is not theoretical:
       * a caret inside a nested node of an editable region reports the property
       * on an ANCESTOR rather than on the node the event came from, and jsdom
       * does not implement it at all — so the guard looked right, tested green
       * against a bare `<div contenteditable>`, and let `?` through from inside
       * every rich-text field in the product. `closest()` asks the question the
       * browser can actually answer. Same three-way test as
       * `use-list-navigation.ts`; they must not drift.
       */
      const target = e.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
        if (target.isContentEditable) return
        if (target.closest("[contenteditable]:not([contenteditable='false'])")) return
      }
      e.preventDefault()
      setOpen((previous) => !previous)
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [])

  return { open, setOpen }
}

/**
 * The mounted pairing of the two: the global `?` listener and the panel it opens.
 *
 * It exists so the root layout can mount one element rather than hold state of its
 * own, and so the listener lives for the life of the session instead of being torn
 * down and re-added on every route change — a key pressed during a navigation would
 * otherwise land on nothing.
 *
 * Renders no DOM at all until the key is pressed.
 */
export function ShortcutsHelp() {
  const { open, setOpen } = useShortcutsOverlay()
  return <ShortcutsOverlay open={open} onClose={() => setOpen(false)} />
}
