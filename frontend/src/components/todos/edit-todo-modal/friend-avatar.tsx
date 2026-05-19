"use client"

import { getHueFromId } from "./utils"

interface MinFriend {
  id: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}

interface FriendAvatarProps {
  friend: MinFriend | null | undefined
  size?: number
  ringColor?: string
  className?: string
  style?: React.CSSProperties
}

function initials(friend: MinFriend | null | undefined): string {
  if (!friend) return "?"
  const f = friend.firstName?.trim()?.[0]
  const l = friend.lastName?.trim()?.[0]
  if (f || l) return `${f ?? ""}${l ?? ""}`.toUpperCase()
  if (friend.email) return friend.email.slice(0, 2).toUpperCase()
  return "?"
}

export function FriendAvatar({ friend, size = 28, ringColor, className, style }: FriendAvatarProps) {
  const hue = friend ? getHueFromId(friend.id) : 200
  const label = initials(friend)

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `linear-gradient(135deg, hsl(${hue}, 52%, 68%), hsl(${(hue + 40) % 360}, 58%, 52%))`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(8, Math.round(size * 0.38)),
        fontWeight: 800,
        color: "white",
        flexShrink: 0,
        userSelect: "none",
        ...(ringColor ? { boxShadow: `0 0 0 2px ${ringColor}` } : {}),
        ...style,
      }}
    >
      {label}
    </div>
  )
}
