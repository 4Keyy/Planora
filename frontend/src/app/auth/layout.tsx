import type { ReactNode } from "react"
import { AuthFrame } from "@/components/auth/auth-frame"

/**
 * Every `/auth/*` route shares one frame — the top bar, the column and the footer — and
 * it lives here, in the layout, because the router keeps a layout mounted across the
 * routes below it. The recovery step scale inside the frame therefore survives the move
 * from one recovery step to the next and can slide its marker, which it could not do from
 * inside a page (or from `template.tsx`, which the router remounts on every navigation).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>
}
