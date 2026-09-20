"use client"

import { useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { RedactionBadge } from "@/components/ui/redaction-badge"
import { Avatar } from "@/components/ui/avatar"
import { NumberRoll } from "@/components/ui/number-roll"
import { FIELD_LABEL_CLASS } from "@/components/ui/field"
import { deriveAudience } from "@/lib/landing-audience"
import { HERO_FRIENDS } from "./fixtures"
import { cn } from "@/lib/utils"
import { DURATION_FAST, EASE_OUT_EXPO } from "@/lib/animations"

/**
 * Block 1 — the thesis as a thing in the hands.
 *
 * `RedactionBadge` and `NumberRoll` are the components the product ships, on fixtures
 * instead of an API. Not copies: a copy diverges from the original on the first change
 * and the landing page starts lying about the product — the same disease as a shortcut
 * map that promises one key while the key does something else.
 *
 * What is NOT reused here is `PresenceRow`, and that is deliberate. It is the product's
 * *worker* primitive: its single spoken sentence reads "… are working on this", which
 * is false about an audience. These people can see the task; they are not doing it. So
 * the faces are `Avatar` — the primitive for a person — under a sentence of this
 * surface's own, with the visual stack `aria-hidden` so a screen-reader user is not
 * walked through a crowd one name at a time.
 *
 * Three layout hazards, all reserved, because layout is decided by the viewport and
 * never by the data:
 *
 *   (a) The badge's label swaps "Private" ↔ "Shared" and carries a rolling count, so
 *       its width moves. It is alone on its flex row with nothing downstream of it.
 *   (b) The face row is empty at zero members, so it would otherwise appear and push
 *       everything below it down. Its wrapper holds a fixed height regardless.
 *   (c) The count is printed here rather than inside the badge, through `NumberRoll`
 *       with a reserved column — the badge takes no `minDigits`, and an unreserved
 *       1 → 2 digit change is exactly the 0.119 CLS that `minDigits` was built to fix.
 */

/** One sentence for assistive tech, in place of a name-by-name walk through the faces. */
function audienceSentence(names: string[]): string {
  if (names.length === 0) return "Nobody else can see this task."
  if (names.length === 1) return `${names[0]} can see this task.`
  const head = names.slice(0, -1).join(", ")
  return `${head} and ${names[names.length - 1]} can see this task.`
}

export function AudienceConsole() {
  const reduce = useReducedMotion() ?? false
  const [selected, setSelected] = useState<string[]>([])

  const audience = deriveAudience(selected.length)
  const members = HERO_FRIENDS.filter((f) => selected.includes(f.id))

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="rounded-lg border border-line bg-paper-raised p-6 shadow-sm sm:p-7">
      <p className={FIELD_LABEL_CLASS}>Who can see it</p>

      {/* (a) The mark is alone on its row: its label and count both change width. */}
      <div className="mt-4 flex min-h-control items-center">
        <RedactionBadge audience={audience} viewerCount={selected.length} size="md" />
      </div>

      {/* (b) Fixed height, so the row appearing pushes nothing down. */}
      <div className="mt-2 flex h-11 items-center">
        {members.length > 0 ? (
          <>
            <span className="sr-only">{audienceSentence(members.map((m) => m.name))}</span>
            <div aria-hidden="true" className="flex items-center">
              {members.map((m, i) => (
                <span
                  key={m.id}
                  className={cn("inline-flex rounded-full ring-2 ring-paper", i > 0 && "-ml-2")}
                >
                  <Avatar
                    firstName={m.name.split(" ")[0]}
                    lastName={m.name.split(" ")[1]}
                    size={32}
                  />
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-body-sm text-ink-subtle">Nobody yet — this task is yours alone.</p>
        )}
      </div>

      <div className="mt-5 h-px w-full bg-line" />

      <p className={cn(FIELD_LABEL_CLASS, "mt-5")}>Add someone</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {HERO_FRIENDS.map((friend) => {
          const on = selected.includes(friend.id)
          return (
            <button
              key={friend.id}
              type="button"
              onClick={() => toggle(friend.id)}
              aria-pressed={on}
              className={cn(
                "inline-flex min-h-control items-center gap-2 rounded-md border px-4 text-body-sm font-semibold",
                "transition-colors duration-fast",
                on
                  ? "border-ink bg-ink text-paper"
                  : "border-line-strong bg-paper text-ink-muted hover:bg-paper-sunken hover:text-ink"
              )}
            >
              <motion.span
                aria-hidden="true"
                className={cn("h-2 w-2 rounded-full", on ? "bg-paper" : "bg-ink-faint")}
                animate={reduce ? undefined : { scale: on ? 1 : 0.6 }}
                transition={{ duration: DURATION_FAST, ease: EASE_OUT_EXPO }}
              />
              {friend.name.split(" ")[0]}
            </button>
          )
        })}
      </div>

      {/* (c) The count, with a reserved column so 1 → 2 digits shifts nothing. */}
      <p className="mt-5 flex items-baseline gap-2 text-body-sm text-ink-muted">
        <span className="font-bold tabular-nums text-ink">
          <NumberRoll value={selected.length} minDigits={1} />
        </span>
        <span>{selected.length === 1 ? "person can read it" : "people can read it"}</span>
      </p>

      <p className="mt-4 text-caption text-ink-subtle">
        Invented names, so you can press this without an account.
      </p>
    </div>
  )
}
