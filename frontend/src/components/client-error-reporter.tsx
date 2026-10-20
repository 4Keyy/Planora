"use client"

import { useEffect } from "react"
import { installClientErrorReporting } from "@/lib/client-errors"

/**
 * Mounted once at the root: an uncaught error or an unhandled rejection anywhere in the app
 * reaches the service logs (`lib/client-errors.ts`). Renders nothing.
 */
export function ClientErrorReporter() {
  useEffect(() => installClientErrorReporting(), [])
  return null
}
