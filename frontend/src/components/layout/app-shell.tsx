import type { ReactNode } from "react"
import { AuthGuard } from "@/components/auth-guard"
import { Navbar } from "@/components/layout/navbar"

/**
 * The frame every signed-in route renders in: the guard, the bar, and one column.
 *
 * Five layouts carried their own copy of it, and none of them gave `<main>` the
 * `id="main"` the root layout's skip link jumps to — so "Skip to content" went nowhere
 * on every screen of the product itself. They also each re-derived a column
 * (`max-w-[1600px] px-4 sm:px-5 lg:px-6`, with `pt-6 md:pt-10` on one and `pt-8` or
 * `py-8` on the others), so page titles started at three different heights.
 *
 * The bar renders outside the guard. It is the same before and after the session
 * restore — only the avatar's initials arrive — so drawing it at once turns the first
 * paint of every signed-in page from a blank screen into the page's frame, with the
 * content filling in beneath it.
 *
 * `pb-28` leaves room at the bottom for the fixed capture control — 56px of bubble, a
 * 16px gutter, 16px of air and the home indicator. Without it the last card on the two
 * routes that mount the control is permanently half-covered; the other routes simply
 * end with the same air.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main id="main" className="pb-28">
        <div className="container-app pt-6 sm:pt-10">
          <AuthGuard>{children}</AuthGuard>
        </div>
      </main>
    </div>
  )
}
