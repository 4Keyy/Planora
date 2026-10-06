import type { ReactNode } from "react"

export const metadata = { title: "Profile" }

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
