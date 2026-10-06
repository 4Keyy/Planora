"use client"

import { useRef } from "react"
import { useInView } from "framer-motion"
import { AudienceRing } from "./audience-ring"

const SIZE = 176

/**
 * The page's last picture: the ring, closing the argument it opened.
 *
 * The hero starts private — just you. The page ends on a circle of three, drawn as the
 * reader arrives, because that is the promise in the heading beside it: you decide who
 * sees a task, and you can see the circle you decided on.
 *
 * The ring is mounted only once the block is in view. `AudienceRing`'s `drawIn` plays on
 * mount, and this block mounts with the page — so without the gate the draw would finish
 * three screens below the fold, unseen, and the reader would arrive at a still picture.
 * Until then an empty box of the same size holds the space, so mounting shifts nothing.
 */
export function ClosingRing() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })

  return (
    <div className="flex flex-col items-center gap-4">
      <div ref={ref} style={{ width: SIZE, height: SIZE }}>
        {inView && (
          <AudienceRing audience="shared" viewerCount={3} size={SIZE} stroke={5} drawIn>
            {/* Not Avatar: it derives initials, and "You" would read "YO". */}
            <span className="grid h-12 w-12 place-items-center rounded-full bg-ink text-caption font-bold text-paper">
              You
            </span>
          </AudienceRing>
        )}
      </div>
      <p className="text-caption font-semibold uppercase tracking-wider text-ink-muted">
        You and three others
      </p>
    </div>
  )
}
