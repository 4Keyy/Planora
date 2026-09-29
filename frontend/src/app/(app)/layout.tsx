import type { ReactNode } from "react"
import { AppShell } from "@/components/layout/app-shell"

/**
 * One layout for every signed-in route, in a route group so the URLs do not change.
 *
 * Each route used to render its own copy of the bar from its own layout, so moving from
 * the dashboard to the task list unmounted one bar and mounted another — and the root
 * template, which remounts whenever the segment under it changes, faded the whole screen
 * in, bar included. Here the bar belongs to a layout the router keeps mounted across all
 * five routes: it stays still, its underline slides to the new tab, and only the page
 * beneath it changes.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
