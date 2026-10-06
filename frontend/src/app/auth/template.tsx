"use client"

import { useEffect, useState } from "react"
import { motion } from "@/components/ui/motion"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"
import { isFirstPageOfVisit, markPageShown } from "@/lib/route-transition"

/**
 * The card's entrance between auth screens.
 *
 * The root template does not help here: it remounts when the segment directly below it
 * changes, and every auth route shares the `auth` segment — so moving from sign-in to
 * create-account swapped the card with no transition at all. This template sits one
 * level down and remounts on each auth route.
 *
 * It may rise as well as fade. The root template is opacity-only because `/tasks` has
 * fixed controls that a transformed ancestor would re-anchor; no auth screen has a fixed
 * descendant (toasts are portalled), and the frame — the only thing here that must not
 * move — sits above this template in `layout.tsx`.
 *
 * The first page of a visit is not animated at all, for the reason the root template
 * documents: an `initial` state is written into the server HTML, and the card would sit
 * invisible until hydration.
 */
export default function AuthTemplate({ children }: { children: React.ReactNode }) {
  const [initial] = useState(() => (isFirstPageOfVisit() ? false : { opacity: 0, y: 8 }))
  useEffect(markPageShown, [])

  return (
    <motion.div initial={initial} animate={{ opacity: 1, y: 0 }} transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}>
      {children}
    </motion.div>
  )
}
