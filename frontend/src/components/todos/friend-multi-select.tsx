"use client"

import { useMemo, useCallback } from "react"
import { Check, Globe2, Lock, UserRound, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { FriendDto } from "@/types/auth"
import { Avatar } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const formatFriendName = (friend: FriendDto) => {
  const fullName = [friend.firstName, friend.lastName].filter(Boolean).join(" ").trim()
  if (fullName) return fullName
  if (friend.email) return friend.email.split("@")[0]
  return friend.id
}

interface FriendMultiSelectProps {
  friends: FriendDto[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  placeholder?: string
  contentClassName?: string
  publicSelected?: boolean
  onPublicChange?: (selected: boolean) => void
}

export function FriendMultiSelect({
  friends,
  selectedIds,
  onChange,
  disabled = false,
  placeholder = "Share with friends (optional)",
  contentClassName,
  publicSelected = false,
  onPublicChange,
}: FriendMultiSelectProps) {
  const selectedFriends = useMemo(
    () => friends.filter((f) => selectedIds.includes(f.id)),
    [friends, selectedIds]
  )
  const visibleSelectedFriends = publicSelected ? [] : selectedFriends

  const label = useMemo(() => {
    if (publicSelected) return "Shared with all friends"
    const selectedCount = selectedIds.length
    if (selectedCount === 0) return placeholder
    if (selectedFriends.length === 0) {
      const noun = selectedCount === 1 ? "friend" : "friends"
      return `Shared with ${selectedCount} ${noun}`
    }
    const names = selectedFriends.slice(0, 2).map(formatFriendName)
    const extraCount = Math.max(0, selectedCount - names.length)
    const extra = extraCount > 0 ? ` +${extraCount}` : ""
    return `Shared with ${names.join(", ")}${extra}`
  }, [publicSelected, selectedFriends, selectedIds.length, placeholder])

  const scopeLabel = publicSelected
    ? "All friends"
    : selectedIds.length > 0
      ? `${selectedIds.length} selected`
      : "Private"

  const toggleFriend = useCallback((id: string) => {
    if (publicSelected) {
      onPublicChange?.(false)
      onChange([id])
      return
    }

    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((fid) => fid !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }, [publicSelected, selectedIds, onChange, onPublicChange])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className={cn(
            "group flex w-full items-center justify-between gap-3 rounded-xl border border-line/80 bg-paper p-2.5 text-left shadow-sm transition-[background-color,border-color,box-shadow,transform,opacity] duration-base",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "hover:border-line-strong hover:bg-paper-sunken/70 hover:shadow-md active:scale-[0.99]"
          )}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-paper-sunken text-ink-muted transition-colors group-hover:bg-paper">
              {publicSelected ? (
                <Globe2 className="h-4 w-4" />
              ) : selectedIds.length > 0 ? (
                <Users className="h-4 w-4" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-body-sm font-bold text-ink">{label}</span>
              <span className="block truncate text-caption font-semibold text-ink-subtle">{scopeLabel}</span>
            </span>
          </span>
          <span className="flex flex-shrink-0 items-center gap-1.5">
            {visibleSelectedFriends.slice(0, 3).map(friend => (
              <span
                key={friend.id}
                className="-ml-1 flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-white shadow-sm first:ml-0"
                title={formatFriendName(friend)}
              >
                <Avatar
                  src={friend.profilePictureUrl}
                  firstName={friend.firstName}
                  lastName={friend.lastName}
                  email={friend.email}
                  size={24}
                />
              </span>
            ))}
            {publicSelected && (
              <span className="rounded-full border border-line bg-paper-sunken px-2 py-1 text-caption font-bold uppercase tracking-[0.06em] text-ink-muted">
                All
              </span>
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      {!disabled && (
        <DropdownMenuContent
          align="center"
          className={cn(
            "w-[min(420px,calc(100vw-2rem))] max-h-80 overflow-y-auto rounded-xl border-line/80 bg-paper p-2 shadow-xl",
            contentClassName
          )}
        >
          <div className="px-2 pb-2 pt-1">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-paper-sunken px-3 py-2 text-caption font-bold text-ink-subtle">
              <Users className="h-3.5 w-3.5" />
              Share scope
            </div>
          </div>
          {onPublicChange && (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  const nextPublic = !publicSelected
                  onPublicChange(nextPublic)
                  if (nextPublic) {
                    onChange([])
                  }
                }}
                className={cn(
                  "cursor-pointer gap-3 rounded-lg px-3 py-3",
                  publicSelected ? "bg-ink text-paper focus:bg-ink focus:text-paper" : "text-ink focus:bg-paper-sunken"
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border",
                    publicSelected ? "border-white bg-paper text-ink" : "border-line-strong bg-paper text-transparent"
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm font-bold">All friends</span>
                  <span className={cn("block text-caption font-semibold", publicSelected ? "text-paper/60" : "text-ink-subtle")}>
                    All accepted friends
                  </span>
                </span>
                <Globe2 className={cn("h-4 w-4 flex-shrink-0", publicSelected ? "text-paper/70" : "text-ink-subtle")} />
              </DropdownMenuItem>
              <div className="my-2 h-px bg-gray-100" />
            </>
          )}
          {friends.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-caption font-bold text-ink-subtle">
              No friends yet.
            </div>
          ) : (
            <div className="space-y-1">
              {friends.map((friend) => {
                const selected = selectedIds.includes(friend.id)
                return (
                  <DropdownMenuItem
                    key={friend.id}
                    onSelect={(event) => {
                      event.preventDefault()
                      toggleFriend(friend.id)
                    }}
                    className={cn(
                      "cursor-pointer gap-3 rounded-lg px-3 py-2.5 text-body-sm transition-colors",
                      selected ? "bg-gray-100 text-ink focus:bg-gray-100" : "focus:bg-paper-sunken"
                    )}
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg">
                      <Avatar
                        src={friend.profilePictureUrl}
                        firstName={friend.firstName}
                        lastName={friend.lastName}
                        email={friend.email}
                        size={32}
                        className="rounded-lg"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{formatFriendName(friend)}</span>
                      {friend.email && (
                        <span className="block truncate text-caption font-semibold text-ink-subtle">{friend.email}</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-colors",
                        selected ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-transparent"
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-paper-sunken px-3 py-2 text-caption font-semibold text-ink-subtle">
            <UserRound className="h-3.5 w-3.5" />
            {publicSelected
              ? "All friends"
              : selectedIds.length > 0
                ? `${selectedIds.length} direct share${selectedIds.length === 1 ? "" : "s"}`
                : "No direct shares"}
          </div>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
