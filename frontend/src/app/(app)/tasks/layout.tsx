import type { ReactNode } from "react"

// A plain string here would clear the root template for nested routes, which is
// how /tasks/completed lost its " · Planora" suffix.
export const metadata = {
  title: { default: "Tasks", template: "%s · Planora" },
}

export default function TasksLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
