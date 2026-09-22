"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { disableDemo, enableDemo } from "@/lib/demo/enable"

/**
 * Installs the demo sandbox for the landing route, and says so on screen.
 *
 * The disclosure is not a legal footnote, it is the thing that makes the sandbox honest.
 * A page that seeds a session and answers its own API without telling anyone would be
 * exactly the deception this work exists to remove; a page that says "this is a sandbox,
 * these people are invented, nothing leaves your browser" and then behaves like the real
 * product is the most truthful demo available short of handing out accounts.
 *
 * `ready` gates the children rather than rendering them immediately: the palette and the
 * list guard on `isAuthenticated`, so mounting them before `enableDemo` has seeded the
 * store means one render where every key is dead. One state flip, no layout change.
 */
export function DemoSandbox({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (pathname !== "/") return
    enableDemo(pathname)
    setReady(true)
    return () => {
      setReady(false)
      disableDemo()
    }
  }, [pathname])

  if (!ready) return null
  return <>{children}</>
}

/**
 * The standing disclosure. Rendered once, near the demos, and deliberately plain: an
 * accent colour or an icon would make it read as a feature callout rather than a fact.
 */
export function SandboxNotice() {
  return (
    <p className="text-caption text-ink-subtle">
      A sandbox in your browser — invented people, invented tasks. It runs the product&rsquo;s
      own code against its own data layer, nothing leaves this tab, and no account exists.
    </p>
  )
}
