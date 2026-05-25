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
        <Image
          src={fullSrc}
          alt={firstName || "User"}
          fill
          className="aspect-square h-full w-full object-cover"
          onError={() => setError(true)}
          unoptimized
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
