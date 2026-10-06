import type { ReactNode } from "react"

export const metadata = { title: "Task branch" }

export default function BranchLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
