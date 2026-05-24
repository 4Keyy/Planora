"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"

interface AvatarProps {
  src?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  size?: number
  className?: string
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

  const initials = useMemo(() => {
    const first = firstName?.trim() || ""
    const last = lastName?.trim() || ""
    const e = email?.trim() || ""

    if (first && last) {
      return `${first[0]}${last[0]}`.toUpperCase()
    }
    if (first) {
      return first.substring(0, 2).toUpperCase()
    }
    if (e) {
      return e.substring(0, 2).toUpperCase()
    }
    return "U"
  }, [firstName, lastName, email])

  const fullSrc = useMemo(() => {
    if (!src || error) return null
    if (src.startsWith("http")) return src
    // Prepend API base URL if relative path
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001"
    return `${baseUrl}${src.startsWith("/") ? "" : "/"}${src}`
  }, [src, error])

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-black text-white",
        className
      )}
      style={{ width: size, height: size }}
    >
      {fullSrc ? (
        <Image
          src={fullSrc}
          alt={firstName || "User"}
          fill
          className="aspect-square h-full w-full object-cover"
          onError={() => setError(true)}
          unoptimized // Required if we don't want to configure domains in next.config.js for dynamic URLs
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
