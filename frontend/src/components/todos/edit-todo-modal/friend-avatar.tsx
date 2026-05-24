"use client"

import { Avatar } from "@/components/ui/avatar"

interface MinFriend {
  id: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  profilePictureUrl?: string | null
}

interface FriendAvatarProps {
  friend: MinFriend | null | undefined
  size?: number
  ringColor?: string
  className?: string
  style?: React.CSSProperties
}

export function FriendAvatar({ friend, size = 28, ringColor, className, style }: FriendAvatarProps) {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        userSelect: "none",
        ...(ringColor ? { boxShadow: `0 0 0 2px ${ringColor}` } : {}),
        ...style,
      }}
    >
      <Avatar
        src={friend?.profilePictureUrl}
        firstName={friend?.firstName}
        lastName={friend?.lastName}
        email={friend?.email}
        size={size}
      />
    </div>
  )
}
