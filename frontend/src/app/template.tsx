"use client"

import { motion } from "framer-motion"
import { EASE_OUT_EXPO } from "@/lib/animations"

/**
 * Route transition wrapper. A `template.tsx` re-mounts on every navigation
 * (unlike `layout.tsx`), so this gives every route a quick, coherent fade-in as
 * the user moves between pages.
 *
 * Opacity only — deliberately no transform. Animating transform here would
 * create a containing block that captures the fixed navbar/background; opacity
 * does not, so position:fixed chrome keeps anchoring to the viewport. Kept short
 * (160ms) so it layers cleanly over each page's own entrance animations and the
 * global MotionConfig still collapses it under prefers-reduced-motion.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: EASE_OUT_EXPO }}
    >
      {children}
    </motion.div>
  )
}
