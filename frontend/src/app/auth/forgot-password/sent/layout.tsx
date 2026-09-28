import { ReactNode } from "react"

export const metadata = { title: "Check your inbox" }

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
