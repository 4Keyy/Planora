"use client"

import "./globals.css"
import { CrashScene } from "@/components/errors/scenes"

/**
 * The last boundary: an error in the root layout itself. It replaces the whole document,
 * so it brings its own `<html>` and stylesheet — and the same scene as every other error
 * page, rather than the browser's blank one.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        <CrashScene error={error} reset={reset} />
      </body>
    </html>
  )
}
