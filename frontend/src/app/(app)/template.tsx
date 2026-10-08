"use client"

import { useEffect } from "react"
import { EntranceTimeline } from "@/components/animated/entrance"
import { markPageShown } from "@/lib/route-transition"

/**
 * The start of every signed-in page's arrival. The bar sits above this, in the layout, so
 * it never moves; the root template does not remount between these routes at all (they
 * share the `(app)` segment), so this one runs once per page shown — on a navigation at
 * once, on a refresh once the session is restored and the guard lets the page through.
 *
 * It used to fade the whole page in, opacity only. Each page now arrives part by part on
 * the timeline this starts (`components/animated/entrance.tsx`), so a whole-page fade on
 * top of that would only dim the first beat of it. Still no transform on this wrapper, for
 * the reason the root template measured: the pages have fixed controls (quick capture, the
 * selection bar, the undo bar) that a transformed ancestor would re-anchor.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  useEffect(markPageShown, [])
  return <EntranceTimeline>{children}</EntranceTimeline>
}
