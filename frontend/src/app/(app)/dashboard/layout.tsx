import type { ReactNode } from "react"

export const metadata = { title: "Dashboard" }

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
