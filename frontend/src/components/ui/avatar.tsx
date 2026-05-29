"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { getApiBaseUrl } from "@/lib/config"

interface AvatarProps {
  src?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  size?: number
  className?: string
  /**
   * Eager-load this avatar instead of letting `next/image` lazy-load it.
   * Set to `true` only for above-the-fold avatars on critical pages — the
   * navbar's current-user avatar is the canonical case. Defaults to `false`
   * so list / picker / card avatars stay lazy and out of the LCP budget.
   */
  priority?: boolean
}

function resolveAvatarSrc(src: string): string {
  if (src.startsWith("http")) return src
  const base = getApiBaseUrl()
  return `${base}${src.startsWith("/") ? src : `/${src}`}`
}

export function Avatar({
  src,
  firstName,
  lastName,
  email,
  size = 40,
  className,
  priority = false,
}: AvatarProps) {
  const [error, setError] = useState(false)

  // Start with null to avoid SSR/client mismatch — getApiBaseUrl() reads
  // window.location which is only available in the browser.
  const [fullSrc, setFullSrc] = useState<string | null>(null)

  useEffect(() => {
    setError(false)
    if (!src) {
      setFullSrc(null)
      return
    }
    setFullSrc(resolveAvatarSrc(src))
  }, [src])

  const initials = useMemo(() => {
    const first = firstName?.trim() || ""
    const last = lastName?.trim() || ""
    const e = email?.trim() || ""

    if (first && last) return `${first[0]}${last[0]}`.toUpperCase()
    if (first) return first.substring(0, 2).toUpperCase()
    if (e) return e.substring(0, 2).toUpperCase()
    return "U"
  }, [firstName, lastName, email])

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-black text-white",
        className
      )}
      style={{ width: size, height: size }}
    >
      {fullSrc && !error ? (
        // T4.11: Let Next.js's image optimizer resize + reformat for the actual
        // display size (sizes prop) instead of shipping the full 64/128/512 WebP
        // variant for a 40 px display. remotePatterns in next.config.js already
        // whitelists the API origin in production and all HTTP/HTTPS hosts in
        // dev, so the /_next/image proxy can reach the avatar URL. onError
        // falls back to the initials block if the optimizer pipeline ever fails.
        <Image
          src={fullSrc}
          alt={firstName || "User"}
          fill
          sizes={`${size}px`}
          className="aspect-square h-full w-full object-cover"
          onError={() => setError(true)}
          // `priority` opts the navbar avatar out of lazy-loading so it counts
          // as an LCP candidate; everywhere else, the default lazy-load keeps
          // avatars off the critical render path.
          priority={priority}
        />
      ) : (
        <span
          className="font-black tracking-tighter"
          style={{ fontSize: size * 0.4 }}
        >
          {initials}
        </span>
      )}
    </div>
  )
}
