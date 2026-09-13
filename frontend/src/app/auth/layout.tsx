import { ReactNode } from "react"

/**
 * The auth routes render their own full-page composition, so this layout adds
 * only the landmark. Without it a screen reader had no main region to jump to
 * on any of the five screens.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-transparent">{children}</main>
}
