"use client"

import { ReactNode } from "react"

export function PageBackground({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <div className="absolute inset-0 bg-gradient-to-br from-white via-gray-50 to-gray-100 pointer-events-none" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-black/[0.02] rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-72 h-72 bg-black/[0.01] rounded-full translate-y-1/2 -translate-x-1/3 blur-2xl pointer-events-none" />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
