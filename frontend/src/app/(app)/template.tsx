"use client"

import { useEffect, useState } from "react"
import { motion } from "@/components/ui/motion"
import { DURATION_UI, EASE_OUT_EXPO } from "@/lib/animations"
import { isFirstPageOfVisit, markPageShown } from "@/lib/route-transition"

/**
 * The page's fade between signed-in routes. The bar sits above this, in the layout, so
 * it never fades; the root template does not remount between these routes at all (they
 * share the `(app)` segment).
 *
 * Opacity only, for the reason the root template measured: these pages have fixed
 * controls (quick capture, the selection bar, the undo bar), and a transformed ancestor
 * re-anchors them for the length of the animation.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const [initial] = useState(() => (isFirstPageOfVisit() ? false : { opacity: 0 }))
  useEffect(markPageShown, [])

  return (
    <motion.div initial={initial} animate={{ opacity: 1 }} transition={{ duration: DURATION_UI, ease: EASE_OUT_EXPO }}>
      {children}
    </motion.div>
  )
}
