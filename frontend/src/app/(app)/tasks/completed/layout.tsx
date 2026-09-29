import { ReactNode } from "react"

export const metadata = { title: "Completed tasks" }

export default function CompletedTasksLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
